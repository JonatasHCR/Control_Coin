import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { money } from '@cc/domain/money';

import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

let f: Fixture;

beforeAll(async () => { await prisma.$connect(); });
beforeEach(async () => { await resetDatabase(); f = await seed(); });

/** The month an expense belongs to — the cycle it was charged in, not the bill's due date. */
async function expenseByMonth(): Promise<Record<string, string>> {
  const rows = await prisma.$queryRaw<{ month: Date; expense_total: unknown }[]>`
    SELECT month, expense_total FROM v_monthly_expense ORDER BY month`;
  return Object.fromEntries(
    rows.map((r) => [r.month.toISOString().slice(0, 7), Number(String(r.expense_total)).toFixed(2)]),
  );
}

describe('BR14 — a card purchase counts on the purchase cycle, not the payment date', () => {
  beforeEach(async () => {
    // UC03: R$ 500 — R$ 300 on Buy in 3x, R$ 200 on Food, bought 22 July.
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'INSTALLMENT',
      categoryId: f.foodCategoryId,
      description: 'Supermarket',
      occurredOn: '2026-07-22',
      totalAmount: money('500.00'),
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('300.00'), installmentCount: 3 },
        { side: 'SOURCE', cardId: f.foodCardId, cardFunction: 'CREDIT', amount: money('200.00'), installmentCount: 1 },
      ],
    });
  });

  it('spreads the installment across three months and keeps Food in July', async () => {
    // The bills fall due in Aug/Sep/Oct — the expense belongs to Jul/Aug/Sep.
    expect(await expenseByMonth()).toEqual({
      '2026-07': '300.00', // Buy part 1 (100) + Food (200)
      '2026-08': '100.00',
      '2026-09': '100.00',
    });
  });

  it('never counts the total twice as a lump sum (BR10)', async () => {
    const months = await expenseByMonth();
    const total = Object.values(months).reduce((a, b) => a + Number(b), 0);
    expect(total.toFixed(2)).toBe('500.00');
  });

  it('gives the category a variance against its target in each month (BR21)', async () => {
    const july = await prisma.$queryRaw<{ variance: unknown }[]>`
      SELECT variance FROM category_variance(${f.userId}::uuid, '2026-07-01'::date)`;
    // Target 1400, spent 300 in July → 1100 saved.
    expect(Number(String(july[0]?.variance)).toFixed(2)).toBe('1100.00');
  });
});
