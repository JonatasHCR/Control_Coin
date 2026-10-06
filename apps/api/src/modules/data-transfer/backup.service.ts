import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { ERROR_CODES } from '@cc/domain/rules';

import { userError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';

const APP = 'control-coin';
const VERSION = 1;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const TABLES = [
  'wallets',
  'accounts',
  'cards',
  'categories',
  'series',
  'transactions',
  'entries',
  'invoices',
  'settlements',
  'budgets',
  'goals',
  'goalContributions',
  'alertRules',
  'planned',
] as const;

type Table = (typeof TABLES)[number];
export type Backup = { app: string; version: number; exportedAt: string; preferences: Row } & Record<Table, Row[]>;

/**
 * Full backup (UC09): every row the user owns, as JSON, restorable into this or
 * another user. Ids are regenerated on restore, so nothing collides. Derived
 * values are not stored (BR36), so restoring the raw rows restores the balances.
 */
@Injectable()
export class BackupService {
  constructor(private readonly prisma: PrismaService) {}

  async export(userId: string): Promise<Backup> {
    const p = this.prisma;
    const user = await p.user.findUniqueOrThrow({ where: { id: userId } });
    const [wallets, accounts, cards, categories, series, transactions, entries, invoices, settlements, budgets, goals, goalContributions, alertRules, planned] =
      await Promise.all([
        p.wallet.findMany({ where: { userId } }),
        p.account.findMany({ where: { userId } }),
        p.card.findMany({ where: { account: { userId } } }),
        p.category.findMany({ where: { userId } }),
        p.series.findMany({ where: { userId } }),
        p.transaction.findMany({ where: { userId } }),
        p.entry.findMany({ where: { transaction: { userId } } }),
        p.invoice.findMany({ where: { card: { account: { userId } } } }),
        p.settlement.findMany({ where: { entry: { transaction: { userId } } } }),
        p.budget.findMany({ where: { userId } }),
        p.goal.findMany({ where: { userId } }),
        p.goalContribution.findMany({ where: { goal: { userId } } }),
        p.alertRule.findMany({ where: { userId } }),
        p.plannedTransaction.findMany({ where: { userId } }),
      ]);

    const strip = (rows: Row[]) => rows.map(({ userId: _u, ...rest }) => rest);
    return {
      app: APP,
      version: VERSION,
      exportedAt: new Date().toISOString(),
      preferences: { mainCurrency: user.mainCurrency, language: user.language, theme: user.theme },
      wallets: strip(wallets),
      accounts: strip(accounts),
      cards,
      categories: strip(categories),
      series: strip(series),
      transactions: strip(transactions).map((t) => ({ ...t, importBatchId: null })),
      entries,
      invoices,
      settlements,
      budgets: strip(budgets),
      goals: strip(goals),
      goalContributions,
      alertRules: strip(alertRules),
      planned: strip(planned),
    };
  }

  async restore(userId: string, file: Buffer, replace: boolean): Promise<Record<Table, number>> {
    const backup = parse(file);

    const existing =
      (await this.prisma.account.count({ where: { userId } })) +
      (await this.prisma.category.count({ where: { userId } })) +
      (await this.prisma.transaction.count({ where: { userId } }));
    if (existing > 0 && !replace) {
      throw userError(ERROR_CODES.DUPLICATE, 'você já tem dados — marque "substituir meus dados" para restaurar o backup');
    }

    const ids = new Map<string, string>();
    const id = (old: string | null | undefined): string | null => {
      if (!old) return null;
      let next = ids.get(old);
      if (!next) ids.set(old, (next = randomUUID()));
      return next;
    };
    const b = backup;

    await this.prisma.$transaction(
      async (tx) => {
        if (replace) await wipe(tx, userId);

        await tx.user.update({ where: { id: userId }, data: pick(b.preferences, ['mainCurrency', 'language', 'theme']) });
        await tx.wallet.createMany({ data: b.wallets.map((r) => ({ ...r, id: id(r.id)!, userId })) as never });
        await tx.account.createMany({ data: b.accounts.map((r) => ({ ...r, id: id(r.id)!, userId, walletId: id(r.walletId) })) as never });
        await tx.card.createMany({ data: b.cards.map((r) => ({ ...r, id: id(r.id)!, accountId: id(r.accountId)! })) as never });
        // One nesting level (UC04): parents before children, or the depth trigger can't see them.
        const cats = [...b.categories].sort((x, y) => Number(!!x.parentId) - Number(!!y.parentId));
        await tx.category.createMany({ data: cats.map((r) => ({ ...r, id: id(r.id)!, userId, parentId: id(r.parentId) })) as never });
        await tx.series.createMany({ data: b.series.map((r) => ({ ...r, id: id(r.id)!, userId })) as never });
        await tx.transaction.createMany({
          data: b.transactions.map((r) => ({
            ...r,
            id: id(r.id)!,
            userId,
            categoryId: id(r.categoryId),
            seriesId: id(r.seriesId),
            importBatchId: null,
          })) as never,
        });
        await tx.entry.createMany({
          data: b.entries.map((r) => ({ ...r, id: id(r.id)!, transactionId: id(r.transactionId)!, accountId: id(r.accountId), cardId: id(r.cardId) })) as never,
        });
        await tx.invoice.createMany({ data: b.invoices.map((r) => ({ ...r, id: id(r.id)!, cardId: id(r.cardId)! })) as never });
        await tx.settlement.createMany({
          data: b.settlements.map((r) => ({ ...r, id: id(r.id)!, entryId: id(r.entryId)!, invoiceId: id(r.invoiceId) })) as never,
        });
        await tx.budget.createMany({ data: b.budgets.map((r) => ({ ...r, id: id(r.id)!, userId, categoryId: id(r.categoryId)! })) as never });
        await tx.goal.createMany({
          data: b.goals.map((r) => ({ ...r, id: id(r.id)!, userId, walletId: id(r.walletId), accountId: id(r.accountId) })) as never,
        });
        await tx.goalContribution.createMany({ data: b.goalContributions.map((r) => ({ ...r, id: id(r.id)!, goalId: id(r.goalId)! })) as never });
        await tx.alertRule.createMany({
          // targetId has no FK; a target that wasn't in the backup becomes "any".
          data: b.alertRules.map((r) => ({ ...r, id: id(r.id)!, userId, targetId: r.targetId ? (ids.get(r.targetId) ?? null) : null })) as never,
        });
        await tx.plannedTransaction.createMany({
          data: b.planned.map((r) => ({
            ...r,
            id: id(r.id)!,
            userId,
            categoryId: id(r.categoryId),
            accountId: id(r.accountId),
            cardId: id(r.cardId),
            destinationAccountId: id(r.destinationAccountId),
            transactionId: r.transactionId ? (ids.get(r.transactionId) ?? null) : null,
          })) as never,
        });
      },
      { timeout: 300_000, maxWait: 10_000 },
    );

    return Object.fromEntries(TABLES.map((t) => [t, b[t].length])) as Record<Table, number>;
  }
}

function parse(file: Buffer): Backup {
  let data: Backup;
  try {
    data = JSON.parse(file.toString('utf8')) as Backup;
  } catch {
    throw userError(ERROR_CODES.VALIDATION_FAILED, 'arquivo não é um backup JSON válido');
  }
  if (data?.app !== APP || typeof data.version !== 'number') {
    throw userError(ERROR_CODES.VALIDATION_FAILED, 'arquivo não é um backup do Control Coin');
  }
  if (data.version > VERSION) {
    throw userError(ERROR_CODES.VALIDATION_FAILED, 'backup de uma versão mais nova do Control Coin');
  }
  for (const t of TABLES) data[t] = Array.isArray(data[t]) ? data[t] : [];
  data.preferences ??= {};
  return data;
}

function pick(row: Row, keys: string[]): Row {
  return Object.fromEntries(keys.filter((k) => row[k] !== undefined).map((k) => [k, row[k]]));
}

/** Children before parents: several FKs are ON DELETE RESTRICT. */
async function wipe(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.notification.deleteMany({ where: { userId } });
  await tx.plannedTransaction.deleteMany({ where: { userId } });
  await tx.alertRule.deleteMany({ where: { userId } });
  await tx.transaction.deleteMany({ where: { userId } }); // cascades entries and settlements
  await tx.importBatch.deleteMany({ where: { userId } });
  await tx.series.deleteMany({ where: { userId } });
  await tx.invoice.deleteMany({ where: { card: { account: { userId } } } });
  await tx.goal.deleteMany({ where: { userId } });
  await tx.budget.deleteMany({ where: { userId } });
  await tx.card.deleteMany({ where: { account: { userId } } });
  await tx.account.deleteMany({ where: { userId } });
  await tx.wallet.deleteMany({ where: { userId } });
  await tx.category.deleteMany({ where: { userId, parentId: { not: null } } });
  await tx.category.deleteMany({ where: { userId } });
}
