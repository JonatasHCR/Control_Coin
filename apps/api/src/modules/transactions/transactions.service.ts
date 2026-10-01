import { Prisma, type PrismaClient } from '@prisma/client';

import {
  addMonths,
  createTransactionSchema,
  invoiceCycleDates,
  invoiceReferenceMonth,
  planSettlements,
  type CreateTransactionInput,
  type EntryInput,
} from '@cc/domain/schemas';
import { money } from '@cc/domain/money';
import { ERROR_CODES } from '@cc/domain/rules';

import { Clock } from '../../common/clock/clock.js';
import { DomainError, mapDatabaseError } from '../../common/errors/domain-error.js';

type Tx = Prisma.TransactionClient;

/**
 * The transaction write path — the one genuinely intricate operation here.
 *
 * Everything downstream (balances, budgets, cost of living, forecasts) is
 * derived from the settlements this writes, so nothing is incremented in place
 * and nothing can drift (BR36).
 *
 * The whole write happens inside one database transaction because BR12's
 * trigger is DEFERRABLE INITIALLY DEFERRED: the transaction and all its entries
 * must be present before the sums are checked at COMMIT.
 */
export class TransactionsService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly clock: Clock,
  ) {}

  async create(userId: string, input: CreateTransactionInput, existingSeriesId?: string) {
    const dto = this.parse(input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        // RLS: transaction-scoped, so a pooled connection cannot leak identity
        // into the next request that reuses it (ARCH05).
        await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        return this.writeTransaction(tx, userId, dto, existingSeriesId);
      });
    } catch (error) {
      const mapped = mapDatabaseError(error);
      if (mapped) throw mapped;
      throw error;
    }
  }

  /**
   * Replace a transaction wholesale — the only safe way to change amounts or
   * sources. The entries and their settlements are a unit re-checked by BR12's
   * deferred trigger, so there is no correct partial edit of them: delete the
   * old spine and write a fresh one in the *same* database transaction, so the
   * trigger sees a balanced result at COMMIT and never an intermediate state.
   *
   * Because every downstream figure is derived (BR36), replacing restores the
   * old invoice/balance and applies the new one with no correction step. The id
   * changes — the caller navigates by nothing but the list afterwards.
   */
  async replace(userId: string, id: string, input: CreateTransactionInput) {
    const dto = this.parse(input);
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.user_id', ${userId}, true)`;
        const existing = await tx.transaction.findFirst({ where: { id, userId } });
        if (!existing) throw new DomainError(ERROR_CODES.NOT_FOUND, 'transaction not found');
        await tx.transaction.delete({ where: { id } }); // cascades entries + settlements
        return this.writeTransaction(tx, userId, dto);
      });
    } catch (error) {
      const mapped = mapDatabaseError(error);
      if (mapped) throw mapped;
      throw error;
    }
  }

  /** Fast feedback. The database re-checks all of it — the schema is not the
   *  authority, it just fails sooner and with better messages (ARCH05). */
  private parse(input: CreateTransactionInput) {
    const parsed = createTransactionSchema.safeParse(input);
    if (!parsed.success) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'invalid transaction', {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /** Write one transaction and its whole spine inside an open db transaction. */
  private async writeTransaction(
    tx: Tx,
    userId: string,
    dto: ReturnType<TransactionsService['parse']>,
    existingSeriesId?: string,
  ) {
    const seriesId = existingSeriesId
      ? existingSeriesId
      : dto.occurrenceType === 'RECURRING' && dto.recurrence
        ? (
            await tx.series.create({
              data: {
                userId,
                frequency: dto.recurrence.frequency,
                intervalCount: dto.recurrence.intervalCount,
                startsOn: new Date(dto.occurredOn),
                endsOn: dto.recurrence.endsOn ? new Date(dto.recurrence.endsOn) : null,
              },
            })
          ).id
        : null;

    const transaction = await tx.transaction.create({
      data: {
        userId,
        categoryId: dto.categoryId, // BR01: may be null
        seriesId,
        kind: dto.kind,
        occurrenceType: dto.occurrenceType,
        description: dto.description ?? null,
        occurredOn: new Date(dto.occurredOn),
        totalAmount: new Prisma.Decimal(dto.totalAmount),
        currency: dto.currency,
      },
    });

    for (const entry of dto.entries) {
      await this.writeEntry(tx, transaction.id, entry, dto.occurredOn);
    }

    return transaction; // deferred triggers fire at COMMIT
  }

  /**
   * Update the metadata that does not touch the split: category, description,
   * date. Changing amounts or sources means deleting and recording afresh —
   * the entries and their settlements are a unit, re-checked by the deferred
   * trigger, so there is no safe partial edit of them.
   */
  async update(
    userId: string,
    id: string,
    patch: { categoryId?: string | null; description?: string | null; occurredOn?: string },
  ) {
    const existing = await this.prisma.transaction.findFirst({ where: { id, userId } });
    if (!existing) throw new DomainError(ERROR_CODES.NOT_FOUND, 'transaction not found');

    const data: Prisma.TransactionUpdateInput = {};
    if (patch.categoryId !== undefined) {
      data.category = patch.categoryId
        ? { connect: { id: patch.categoryId } }
        : { disconnect: true }; // BR01: clearing to Uncategorized is legitimate
    }
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.occurredOn !== undefined) data.occurredOn = new Date(patch.occurredOn);

    return this.prisma.transaction.update({ where: { id }, data });
  }

  /**
   * Delete a transaction and everything derived from it. The entries and
   * settlements go with it (ON DELETE CASCADE down the spine), and because
   * balances and invoice figures are derived (BR36), deleting an invoice
   * payment restores the invoice's open amount with no correction step.
   */
  async remove(userId: string, id: string) {
    const existing = await this.prisma.transaction.findFirst({ where: { id, userId } });
    if (!existing) throw new DomainError(ERROR_CODES.NOT_FOUND, 'transaction not found');
    await this.prisma.transaction.delete({ where: { id } });
    return { deleted: id };
  }

  private async writeEntry(
    tx: Tx,
    transactionId: string,
    entry: EntryInput,
    occurredOn: string,
  ): Promise<void> {
    const row = await tx.entry.create({
      data: {
        transactionId,
        accountId: entry.accountId ?? null,
        cardId: entry.cardId ?? null,
        side: entry.side,
        cardFunction: entry.cardFunction ?? null,
        amount: new Prisma.Decimal(entry.amount),
        installmentCount: entry.installmentCount ?? 1,
      },
    });

    // BR07: a credit charge lands on an invoice cycle; debit and direct
    // payments settle immediately against the account.
    const card = entry.cardId
      ? await tx.card.findUniqueOrThrow({ where: { id: entry.cardId } })
      : null;
    const isCredit = entry.cardFunction === 'CREDIT' && entry.side === 'SOURCE';

    const plan = planSettlements(
      {
        amount: entry.amount,
        installmentCount: entry.installmentCount ?? 1,
        ...(entry.cardFunction ? { cardFunction: entry.cardFunction } : {}),
      },
      occurredOn,
    );

    // The cycle a purchase belongs to is decided by its *charge* month, not by
    // when the resulting bill happens to fall due. Installment part `i` is
    // charged to the cycle `i` months after the first — so a 22 July purchase
    // in 3× charges the July, August and September invoices.
    const closingDay = card?.closingDay ?? 28;
    const dueDay = card?.dueDay ?? 5;
    const baseReference = invoiceReferenceMonth(occurredOn, closingDay);

    for (const [index, part] of plan.entries()) {
      if (!isCredit || !card) {
        await tx.settlement.create({
          data: {
            entryId: row.id,
            invoiceId: null,
            sequenceNo: part.sequenceNo,
            amount: new Prisma.Decimal(part.amount),
            dueOn: new Date(part.dueOn),
            settledOn: new Date(part.dueOn), // debit and direct payments move now
          },
        });
        continue;
      }

      const referenceMonth = addMonths(baseReference, index);
      const invoice = await this.openInvoice(tx, card.id, referenceMonth, closingDay, dueDay);

      await tx.settlement.create({
        data: {
          entryId: row.id,
          invoiceId: invoice.id,
          sequenceNo: part.sequenceNo,
          amount: new Prisma.Decimal(part.amount),
          dueOn: invoice.dueOn, // the charge is owed when its invoice falls due
          settledOn: null, //      owed, not paid (BR07)
        },
      });
    }
  }

  /** The invoice for a reference month, opening the cycle if it does not exist. */
  private async openInvoice(
    tx: Tx,
    cardId: string,
    referenceMonth: string,
    closingDay: number,
    dueDay: number,
  ) {
    const existing = await tx.invoice.findUnique({
      where: { cardId_referenceMonth: { cardId, referenceMonth: new Date(referenceMonth) } },
    });
    if (existing) return existing;

    // The due date follows the closing date: same month when the due day is the
    // later of the two (close 04, due 11), the next month otherwise (BR07).
    const { closesOn, dueOn } = invoiceCycleDates(referenceMonth, closingDay, dueDay);
    return tx.invoice.create({
      data: {
        cardId,
        referenceMonth: new Date(referenceMonth),
        closesOn: new Date(closesOn),
        dueOn: new Date(dueOn),
        status: 'OPEN',
      },
    });
  }

  /**
   * BR10 — a recurrence is a SERIES of transactions, not one transaction
   * carrying a flag. Nothing ever generated the later ones, so a monthly
   * income stayed in the month it was created; this walks each series forward
   * from its newest occurrence and writes the ones already due.
   *
   * Only up to today: months ahead stay projections (BR19), never rows a user
   * could edit into disagreeing with the series. Re-running writes nothing —
   * the cursor is read from the data, not stored.
   */
  async expandDue(userId: string): Promise<number> {
    const today = this.clock.now().toISOString().slice(0, 10);
    const series = await this.prisma.series.findMany({ where: { userId, active: true } });
    let written = 0;

    for (const s of series) {
      const last = await this.prisma.transaction.findFirst({
        where: { seriesId: s.id },
        orderBy: { occurredOn: 'desc' },
        include: { entries: true },
      });
      if (!last) continue;

      const endsOn = s.endsOn ? s.endsOn.toISOString().slice(0, 10) : null;
      let cursor = last.occurredOn.toISOString().slice(0, 10);

      // The guard only stops a corrupt interval from looping; a real series
      // reaches today in a handful of steps.
      for (let guard = 0; guard < 240; guard += 1) {
        const next = stepDate(cursor, s.frequency, s.intervalCount);
        if (next > today || (endsOn && next > endsOn)) break;

        await this.create(userId, {
          kind: last.kind as 'INCOME' | 'EXPENSE' | 'TRANSFER',
          occurrenceType: 'RECURRING',
          categoryId: last.categoryId,
          description: last.description ?? undefined,
          occurredOn: next,
          totalAmount: money(last.totalAmount.toFixed(2)),
          currency: last.currency,
          entries: last.entries.map((e) => ({
            side: e.side as 'SOURCE' | 'DESTINATION',
            amount: money(e.amount.toFixed(2)),
            ...(e.cardId
              ? { cardId: e.cardId, cardFunction: e.cardFunction as 'CREDIT' | 'DEBIT' }
              : { accountId: e.accountId! }),
          })),
          recurrence: {
            frequency: s.frequency as 'WEEKLY' | 'MONTHLY' | 'YEARLY',
            intervalCount: s.intervalCount,
            endsOn,
          },
        }, s.id);

        written += 1;
        cursor = next;
      }
    }
    return written;
  }

  /** What the new-transaction form needs to render its selects (UC03). */
  async options(userId: string) {
    const [accounts, cards, categories] = await Promise.all([
      this.prisma.account.findMany({
        where: { userId, archived: false },
        // BR37: the name alone no longer identifies an account, so the wallet
        // comes with it — two "Nubank" in different wallets are both legal.
        select: { id: true, name: true, wallet: { select: { name: true } } },
        orderBy: { name: 'asc' },
      }),
      this.prisma.card.findMany({
        where: { account: { userId }, archived: false },
        select: {
          id: true, name: true, allowsCredit: true, allowsDebit: true,
          account: { select: { name: true, wallet: { select: { name: true } } } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.category.findMany({
        where: { userId, archived: false },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    return {
      sources: [
        // BR09: a card offers only the functions it actually enables.
        ...cards.map((c) => ({
          id: c.id,
          label: `${c.name} · ${qualify(c.account.name, c.account.wallet?.name)}`,
          kind: 'CARD' as const,
          functions: [
            ...(c.allowsCredit ? ['CREDIT' as const] : []),
            ...(c.allowsDebit ? ['DEBIT' as const] : []),
          ],
        })),
        ...accounts.map((a) => ({
          id: a.id,
          label: qualify(a.name, a.wallet?.name),
          kind: 'ACCOUNT' as const,
          functions: [] as ('CREDIT' | 'DEBIT')[],
        })),
      ],
      categories,
    };
  }

  /** One transaction with its entries and series — everything the edit form
   *  needs to prefill kind, occurrence, recurrence and the split (UC03). */
  async findOne(userId: string, id: string) {
    const tx = await this.prisma.transaction.findFirst({
      where: { id, userId },
      include: {
        category: { select: { id: true, name: true } },
        series: true,
        entries: {
          include: {
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!tx) throw new DomainError(ERROR_CODES.NOT_FOUND, 'transaction not found');
    return tx;
  }

  /** The period's transactions with their entries — reads, no aggregation. */
  /**
   * The month's transactions, narrowed by where the money moved.
   *
   * A wallet filter reaches a card through its parent account (BR06), so
   * picking "Emergency" shows the cards issued by its accounts too — anything
   * else would hide half a wallet's spending from its own scope (BR16).
   */
  async list(userId: string, period?: string, filter: ListFilter = {}) {
    // Catch the series up before reading: an occurrence that is already due
    // must be a row, not a gap (BR10).
    await this.expandDue(userId);
    // An explicit range wins over the month; the month stays the default so a
    // bare read still answers the question the dashboard asks (BR19).
    const [from, to] =
      filter.from || filter.to
        ? [
            filter.from ? new Date(`${filter.from}T00:00:00.000Z`) : new Date(Date.UTC(1970, 0, 1)),
            filter.to ? new Date(`${filter.to}T00:00:00.000Z`) : new Date(Date.UTC(9999, 0, 1)),
          ]
        : monthBounds(period);

    const source: Prisma.EntryWhereInput[] = [];
    if (filter.accountId) source.push({ accountId: filter.accountId });
    if (filter.cardId) source.push({ cardId: filter.cardId });
    if (filter.walletIds?.length) {
      source.push(
        { account: { walletId: { in: filter.walletIds } } },
        { card: { account: { walletId: { in: filter.walletIds } } } },
      );
    }

    return this.prisma.transaction.findMany({
      where: {
        userId,
        occurredOn: { gte: from, lte: to },
        ...(filter.categoryId === 'none'
          ? { categoryId: null } // BR01 — "Uncategorized" is a real filter
          : filter.categoryId
            ? { categoryId: filter.categoryId }
            : {}),
        ...(filter.kind ? { kind: filter.kind } : {}),
        ...(filter.occurrenceType ? { occurrenceType: filter.occurrenceType } : {}),
        ...(source.length > 0 ? { entries: { some: { OR: source } } } : {}),
      },
      include: {
        category: { select: { id: true, name: true, isEssential: true } },
        entries: {
          include: {
            account: { select: { id: true, name: true } },
            card: { select: { id: true, name: true } },
            settlements: { orderBy: { sequenceNo: 'asc' } },
          },
        },
      },
      orderBy: [{ occurredOn: 'desc' }, { createdAt: 'desc' }],
    });
  }
}

/** What the transactions screen may narrow by. */
export interface ListFilter {
  walletIds?: string[];
  accountId?: string;
  cardId?: string;
  categoryId?: string;
  /** An inclusive ISO range; when given it replaces the month entirely. */
  from?: string;
  to?: string;
  kind?: 'INCOME' | 'EXPENSE' | 'TRANSFER';
  occurrenceType?: 'OCCASIONAL' | 'RECURRING' | 'INSTALLMENT';
}

/** A month string like 2026-07 to its first and last day. */
function monthBounds(period?: string): [Date, Date] {
  const month = period ?? new Date().toISOString().slice(0, 7);
  const [y, m] = month.split('-').map(Number) as [number, number];
  return [new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 0))];
}

/** BR37 — an account is named by its wallet as well, or it is ambiguous. */
function qualify(account: string, wallet: string | null | undefined): string {
  return wallet ? `${wallet} › ${account}` : account;
}

/** One step of a recurrence, clamped so the 31st survives February (BR10). */
function stepDate(from: string, frequency: string, interval: number): string {
  const [y, m, d] = from.split('-').map(Number) as [number, number, number];
  const n = Math.max(interval, 1);

  if (frequency === 'WEEKLY') {
    return new Date(Date.UTC(y, m - 1, d + 7 * n)).toISOString().slice(0, 10);
  }

  const months = frequency === 'YEARLY' ? 12 * n : n;
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)))
    .toISOString()
    .slice(0, 10);
}
