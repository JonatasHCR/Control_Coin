import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { PrismaService } from '../../database/prisma.service.js';

/**
 * Report reads go through raw SQL, not Prisma.
 *
 * Half of the physical model is views and set-returning functions that Prisma
 * models neither (ARCH05). Each result is still parsed by a zod schema, so raw
 * SQL keeps a typed boundary rather than leaking `any` into the service.
 */

/** Postgres NUMERIC arrives as a Prisma.Decimal, not a string (BR36 keeps it exact). */
const toFixed2 = (v: unknown): string => Number(String(v)).toFixed(2);

const numeric = z.unknown().transform((v) => (v === null || v === undefined ? '0.00' : toFixed2(v)));
const nullableNumeric = z.unknown().transform((v) =>
  v === null || v === undefined ? null : toFixed2(v),
);

const periodBalanceRow = z.object({
  opening_balance: numeric,
  income: numeric,
  expenses: numeric,
  available: numeric,
  closing_balance: numeric,
});

const costOfLivingRow = z.object({
  months_used: z.unknown().transform((v) => Number(String(v ?? 0))),
  average_expense: numeric,
  average_essential: numeric,
  average_discretionary: numeric,
  min_month: numeric,
  max_month: numeric,
});

const essentialCostRow = z.object({
  month_essential: numeric,
  year_average: numeric,
  months: z.unknown().transform((v) => Number(String(v))),
});

const categoryTotalRow = z.object({
  category_id: z.string().nullable(),
  name: z.string().nullable(),
  is_essential: z.unknown().transform((v) => (v === null || v === undefined ? null : v === true)),
  total: numeric,
});

const varianceRow = z.object({
  category_id: z.string(),
  name: z.string(),
  is_essential: z.unknown().transform((v) => v === true),
  monthly_target: nullableNumeric,
  actual: numeric,
  variance: nullableNumeric,
});

const invoiceRow = z.object({
  invoice_id: z.string(),
  card_id: z.string(),
  reference_month: z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)),
  status: z.string(),
  due_on: z.union([z.date(), z.string()]).transform((v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v)),
  charged: numeric,
  paid: numeric,
  open_amount: numeric,
  is_overdue: z.unknown().transform((v) => v === true),
  days_overdue: z.unknown().transform((v) => Number(String(v ?? 0))),
});

@Injectable()
export class ReportsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** BR34/BR35: opening + income − expenses = closing, the carry kept separate. */
  async periodBalance(userId: string, month: string, wallets: string[] | null) {
    const rows = await this.prisma.$queryRaw`
      SELECT * FROM period_balance(${userId}::uuid, ${month}::date, ${wallets}::uuid[])`;
    return periodBalanceRow.array().parse(rows)[0] ?? null;
  }

  /** BR14/BR18: complete months only, with the essential split. */
  async costOfLiving(userId: string, months: number, wallets: string[] | null) {
    const rows = await this.prisma.$queryRaw`
      SELECT * FROM cost_of_living(${userId}::uuid, ${months}::int, ${wallets}::uuid[])`;
    return costOfLivingRow.array().parse(rows)[0] ?? null;
  }

  /**
   * BR14: the month's cost of living is what it spent in ESSENTIAL categories;
   * beside it, the year's monthly average = January through that month ÷ the
   * month's number (the month itself included, complete or not).
   */
  async essentialCost(userId: string, month: string, wallets: string[] | null) {
    const rows = await this.prisma.$queryRaw`
      SELECT COALESCE(SUM(essential_total) FILTER (WHERE month = date_trunc('month', ${month}::date)::date), 0) AS month_essential,
             COALESCE(SUM(essential_total), 0) / EXTRACT(MONTH FROM ${month}::date) AS year_average,
             EXTRACT(MONTH FROM ${month}::date)::int AS months
        FROM v_monthly_expense
       WHERE user_id = ${userId}::uuid
         AND month BETWEEN date_trunc('year', ${month}::date)::date AND date_trunc('month', ${month}::date)::date
         AND (${wallets}::uuid[] IS NULL OR wallet_id = ANY (${wallets}::uuid[]))`;
    return essentialCostRow.array().parse(rows)[0]!;
  }

  /** BR01/BR13: Uncategorized is shown, never dropped; kinds are never netted. */
  async categoryBreakdown(userId: string, month: string) {
    const rows = await this.prisma.$queryRaw`
      SELECT c.id::text          AS category_id,
             c.name              AS name,
             c.is_essential      AS is_essential,
             SUM(s.amount)::text AS total
        FROM settlement s
        JOIN entry e        ON e.id = s.entry_id
        JOIN transaction t  ON t.id = e.transaction_id
        LEFT JOIN category c ON c.id = t.category_id
       WHERE t.user_id = ${userId}::uuid
         AND t.kind = 'EXPENSE'
         AND e.side = 'SOURCE'
         AND settlement_competence_month(s.invoice_id, s.due_on, t.occurred_on, s.sequence_no)
             = date_trunc('month', ${month}::date)::date
       GROUP BY c.id, c.name, c.is_essential
       ORDER BY SUM(s.amount) DESC`;
    return categoryTotalRow.array().parse(rows);
  }

  /** BR21: no target means a null variance, never a verdict from the average. */
  async variance(userId: string, month: string) {
    const rows = await this.prisma.$queryRaw`
      SELECT category_id::text, name, is_essential, monthly_target::text,
             actual::text, variance::text
        FROM category_variance(${userId}::uuid, ${month}::date)
       ORDER BY variance ASC NULLS LAST`;
    return varianceRow.array().parse(rows);
  }

  /** BR32: charged, paid, open and overdue are all derived (BR36). */
  /**
   * BR16 — an invoice belongs to the wallet of the account that issued the
   * card (BR06), so a scoped dashboard must not show another wallet's debt.
   * Without this the "committed" figure was the same in every scope, and a
   * wallet with no card of its own still reported someone else's invoices.
   */
  async invoices(userId: string, wallets: string[] | null) {
    const rows = await this.prisma.$queryRaw`
      SELECT v.invoice_id::text, v.card_id::text, v.reference_month, v.status,
             v.due_on, v.charged::text, v.paid::text, v.open_amount::text,
             v.is_overdue, v.days_overdue
        FROM v_invoice_total v
        JOIN card ca    ON ca.id = v.card_id
        JOIN account a  ON a.id = ca.account_id
       WHERE a.user_id = ${userId}::uuid
         -- The dashboard reports COMMITTED spending (BR08): an invoice that is
         -- settled owes nothing and belongs in the invoices screen's history,
         -- not in a panel that reads "faturas em aberto".
         AND v.open_amount > 0
         AND (${wallets}::uuid[] IS NULL OR a.wallet_id = ANY (${wallets}::uuid[]))
       ORDER BY v.reference_month DESC`;
    return invoiceRow.array().parse(rows);
  }

  /** BR39 — what is owed, never netted against what is held. */
  async debts(userId: string) {
    const rows = await this.prisma.$queryRaw`
      SELECT a.id::text AS category_id, a.name, NULL::boolean AS is_essential,
             (-b.balance)::text AS total
        FROM account a
        JOIN v_account_balance b ON b.account_id = a.id
       WHERE a.user_id = ${userId}::uuid AND a.type = 'LIABILITY' AND b.balance <> 0
       ORDER BY a.name`;
    return categoryTotalRow.array().parse(rows);
  }

  async walletBalances(userId: string) {
    const rows = await this.prisma.$queryRaw`
      SELECT wallet_id::text AS category_id, name, NULL::boolean AS is_essential,
             balance::text   AS total
        FROM v_wallet_balance WHERE user_id = ${userId}::uuid ORDER BY name`;
    return categoryTotalRow.array().parse(rows);
  }
}
