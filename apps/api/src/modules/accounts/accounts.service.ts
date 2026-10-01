import { Injectable } from '@nestjs/common';

import { invoiceCycleDates } from '@cc/domain/schemas';
import { ERROR_CODES } from '@cc/domain/rules';

import { DomainError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * The account hierarchy: wallet › account › card (UC02, UC10).
 *
 * BR06 is structural — a card row cannot exist without an account — so this
 * service validates only what structure cannot: that a link belongs to the
 * same user, and that a card enables at least one function (BR09).
 */
@Injectable()
export class AccountsService {
  constructor(private readonly prisma: PrismaService) {}

  /** The whole tree with derived balances, for the accounts screen. */
  async tree(userId: string) {
    const [wallets, accounts, cards, balances] = await Promise.all([
      this.prisma.wallet.findMany({ where: { userId, archived: false }, orderBy: { name: 'asc' } }),
      this.prisma.account.findMany({ where: { userId, archived: false }, orderBy: { name: 'asc' } }),
      this.prisma.card.findMany({
        where: { account: { userId }, archived: false },
        orderBy: { name: 'asc' },
      }),
      this.prisma.$queryRaw<{ account_id: string; balance: unknown }[]>`
        SELECT account_id::text, balance FROM v_account_balance WHERE user_id = ${userId}::uuid`,
      ]);

    const invoices = await this.prisma.$queryRaw<
      { card_id: string; open_amount: unknown; is_overdue: boolean }[]
    >`
      SELECT v.card_id::text, v.open_amount, v.is_overdue
        FROM v_invoice_total v
        JOIN card c ON c.id = v.card_id
        JOIN account a ON a.id = c.account_id
       WHERE a.user_id = ${userId}::uuid AND v.open_amount > 0`;

    const balanceOf = (id: string): string =>
      Number(String(balances.find((b) => b.account_id === id)?.balance ?? 0)).toFixed(2);

    const cardOf = (accountId: string) =>
      cards
        .filter((c) => c.accountId === accountId)
        .map((c) => ({
          id: c.id,
          name: c.name,
          // BR09: the functions this card actually enables.
          functions: [
            ...(c.allowsCredit ? ['CREDIT' as const] : []),
            ...(c.allowsDebit ? ['DEBIT' as const] : []),
          ],
          closingDay: c.closingDay,
          dueDay: c.dueDay,
          openInvoices: invoices
            .filter((i) => i.card_id === c.id)
            .reduce((sum, i) => sum + Number(String(i.open_amount)), 0)
            .toFixed(2),
          overdue: invoices.some((i) => i.card_id === c.id && i.is_overdue),
        }));

    const describe = (a: (typeof accounts)[number]) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      currency: a.currency,
      balance: balanceOf(a.id),
      cards: cardOf(a.id),
    });

    return {
      wallets: wallets.map((w) => {
        const own = accounts.filter((a) => a.walletId === w.id);
        return {
          id: w.id,
          name: w.name,
          // BR08: a wallet is the sum of its accounts; open invoices are
          // committed spending and are reported separately, never as balance.
          balance: own.reduce((sum, a) => sum + Number(balanceOf(a.id)), 0).toFixed(2),
          accounts: own.map(describe),
        };
      }),
      // BR16: an account in no wallet is still reachable as its own scope.
      unassigned: accounts.filter((a) => a.walletId === null).map(describe),
    };
  }

  createWallet(userId: string, name: string) {
    return this.prisma.wallet.create({ data: { userId, name } });
  }

  createAccount(
    userId: string,
    input: { name: string; type: 'BANK' | 'CASH' | 'LIABILITY'; currency: string; initialBalance: string; walletId?: string | null },
  ) {
    return this.prisma.account.create({
      data: {
        userId,
        name: input.name,
        type: input.type,
        currency: input.currency,
        initialBalance: input.initialBalance,
        walletId: input.walletId ?? null,
      },
    });
  }

  async createCard(
    userId: string,
    input: {
      accountId: string;
      name: string;
      allowsCredit: boolean;
      allowsDebit: boolean;
      creditLimit?: string | null;
      closingDay?: number | null;
      dueDay?: number | null;
    },
  ) {
    // BR06: the parent must belong to the caller. RLS covers the read path;
    // this makes the write refuse loudly rather than silently miss.
    const account = await this.prisma.account.findFirst({
      where: { id: input.accountId, userId },
    });
    if (!account) throw new DomainError(ERROR_CODES.NOT_FOUND, 'account not found');

    return this.prisma.card.create({
      data: {
        accountId: input.accountId,
        name: input.name,
        allowsCredit: input.allowsCredit,
        allowsDebit: input.allowsDebit,
        creditLimit: input.creditLimit ?? null,
        closingDay: input.closingDay ?? null,
        dueDay: input.dueDay ?? null,
      },
    });
  }

  async updateWallet(userId: string, id: string, patch: { name?: string; description?: string | null }) {
    await this.owned('wallet', userId, id);
    return this.prisma.wallet.update({ where: { id }, data: patch });
  }

  async updateAccount(userId: string, id: string, patch: { name?: string }) {
    await this.owned('account', userId, id);
    return this.prisma.account.update({ where: { id }, data: patch });
  }

  async updateCard(
    userId: string,
    id: string,
    patch: {
      name?: string;
      allowsCredit?: boolean;
      allowsDebit?: boolean;
      creditLimit?: string | null;
      closingDay?: number | null;
      dueDay?: number | null;
    },
  ) {
    const card = await this.prisma.card.findFirst({ where: { id, account: { userId } } });
    if (!card) throw new DomainError(ERROR_CODES.NOT_FOUND, 'card not found');
    // BR09: a card must keep at least one function — the CHECK enforces it, but
    // fail here with a clear code rather than a raw constraint violation.
    const credit = patch.allowsCredit ?? card.allowsCredit;
    const debit = patch.allowsDebit ?? card.allowsDebit;
    if (!credit && !debit) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'BR09 — a card enables at least one function');
    }
    const updated = await this.prisma.card.update({ where: { id }, data: patch });

    // Changing the cycle days re-dates the card's still-unpaid invoices, so the
    // new closing/due day is reflected (BR07). Settled cycles are history and
    // keep their dates; the balance that decides "unpaid" is derived (BR36), so
    // it comes from the view, never a stored column.
    if (patch.closingDay !== undefined || patch.dueDay !== undefined) {
      const closingDay = updated.closingDay ?? 28;
      const dueDay = updated.dueDay ?? 5;
      const unpaid = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT v.invoice_id AS id FROM v_invoice_total v
         WHERE v.card_id = ${id}::uuid AND v.open_amount > 0`;
      const invoices = await this.prisma.invoice.findMany({
        where: { id: { in: unpaid.map((u) => u.id) } },
      });
      for (const inv of invoices) {
        const ref = inv.referenceMonth.toISOString().slice(0, 10);
        const { closesOn, dueOn } = invoiceCycleDates(ref, closingDay, dueDay);
        await this.prisma.invoice.update({
          where: { id: inv.id },
          data: { closesOn: new Date(closesOn), dueOn: new Date(dueOn) },
        });
      }
    }
    return updated;
  }

  /**
   * UC02: deletion offers **archive instead** when there is history. Archiving
   * hides the thing from pickers and default lists while its transactions and
   * balances stay intact.
   */
  archive(userId: string, kind: 'WALLET' | 'ACCOUNT' | 'CARD', id: string, archived = true) {
    const table = kind === 'WALLET' ? this.prisma.wallet : kind === 'ACCOUNT' ? this.prisma.account : this.prisma.card;
    // @ts-expect-error the three delegates share this shape
    return table.updateMany({
      where: kind === 'CARD' ? { id, account: { userId } } : { id, userId },
      data: { archived },
    });
  }

  /**
   * Delete only when nothing depends on it. Accounts and cards are
   * ON DELETE RESTRICT precisely so an account with history cannot vanish
   * (UC02) — so we check first and point the user at archive.
   */
  async remove(userId: string, kind: 'WALLET' | 'ACCOUNT' | 'CARD', id: string) {
    if (kind === 'CARD') {
      const uses = await this.prisma.entry.count({ where: { cardId: id } });
      if (uses > 0) throw this.hasHistory('cartão');
      await this.owned('card', userId, id, true);
      await this.prisma.card.delete({ where: { id } });
    } else if (kind === 'ACCOUNT') {
      const uses = await this.prisma.entry.count({ where: { accountId: id } });
      const cards = await this.prisma.card.count({ where: { accountId: id } });
      if (uses > 0 || cards > 0) throw this.hasHistory('conta');
      await this.owned('account', userId, id);
      await this.prisma.account.delete({ where: { id } });
    } else {
      const accounts = await this.prisma.account.count({ where: { walletId: id } });
      if (accounts > 0) throw this.hasHistory('carteira');
      await this.owned('wallet', userId, id);
      await this.prisma.wallet.delete({ where: { id } });
    }
    return { deleted: id };
  }

  private hasHistory(what: string): DomainError {
    return new DomainError(
      ERROR_CODES.VALIDATION_FAILED,
      `esta ${what} tem histórico — arquive em vez de excluir`,
    );
  }

  private async owned(kind: 'wallet' | 'account' | 'card', userId: string, id: string, viaAccount = false) {
    const where = viaAccount ? { id, account: { userId } } : { id, userId };
    // @ts-expect-error the three delegates share findFirst
    const row = await this.prisma[kind].findFirst({ where });
    if (!row) throw new DomainError(ERROR_CODES.NOT_FOUND, `${kind} not found`);
    return row;
  }

  /** UC10: moving a card to another account, or an account to another wallet. */
  async link(userId: string, kind: 'ACCOUNT' | 'CARD', id: string, parentId: string | null) {
    if (kind === 'ACCOUNT') {
      if (parentId) {
        const wallet = await this.prisma.wallet.findFirst({ where: { id: parentId, userId } });
        if (!wallet) throw new DomainError(ERROR_CODES.NOT_FOUND, 'wallet not found');
      }
      return this.prisma.account.update({ where: { id }, data: { walletId: parentId } });
    }

    if (!parentId) {
      // BR06: a card without an account is unrepresentable, not merely invalid.
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'a card must belong to an account');
    }
    const account = await this.prisma.account.findFirst({ where: { id: parentId, userId } });
    if (!account) throw new DomainError(ERROR_CODES.NOT_FOUND, 'account not found');
    return this.prisma.card.update({ where: { id }, data: { accountId: parentId } });
  }
}
