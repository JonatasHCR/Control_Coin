import { beforeEach, describe, expect, it } from 'vitest';

import { ReportsRepository } from './reports.repository.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const reports = new ReportsRepository(prisma as never);

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

/** Buy closes on the 28th, so the 29th lands on the NEXT invoice. */
const afterClosing = (installmentCount: number) =>
  transactions.create(f.userId, {
    kind: 'EXPENSE',
    occurrenceType: installmentCount > 1 ? 'INSTALLMENT' : 'OCCASIONAL',
    categoryId: f.foodCategoryId,
    description: 'Mercado',
    occurredOn: '2026-07-29',
    totalAmount: '300.00',
    currency: 'BRL',
    entries: [{ side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: '300.00', installmentCount }],
  } as never);

const spentIn = async (month: string) =>
  (await reports.categoryBreakdown(f.userId, month)).find((c) => c.category_id === f.foodCategoryId)?.total ?? '0.00';
const actualIn = async (month: string) =>
  (await reports.variance(f.userId, month)).find((v) => v.category_id === f.foodCategoryId)!.actual;

describe('BR14 — a card purchase counts on the purchase date, not the invoice month', () => {
  it('a purchase after the closing day stays in its own month', async () => {
    await afterClosing(1);
    expect(await spentIn('2026-07-01')).toBe('300.00');
    expect(await spentIn('2026-08-01')).toBe('0.00');
    expect(await actualIn('2026-07-01')).toBe('300.00');
  });

  it('each installment part counts in the month it falls, from the purchase month', async () => {
    await afterClosing(3);
    expect(await spentIn('2026-07-01')).toBe('100.00');
    expect(await spentIn('2026-08-01')).toBe('100.00');
    expect(await spentIn('2026-09-01')).toBe('100.00');
    expect(await spentIn('2026-10-01')).toBe('0.00');
  });
});

describe('BR14 — cost of living: essential spending, averaged over the year so far', () => {
  const spend = (date: string, amount: string, categoryId: string | null) =>
    transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId,
      description: 'x',
      occurredOn: date,
      totalAmount: amount,
      currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.itauId, amount }],
    } as never);

  it('sums essential categories only, and divides January–month by the month number', async () => {
    const leisure = await prisma.category.create({ data: { userId: f.userId, name: 'Lazer', isEssential: false } });
    await spend('2026-01-10', '300.00', f.foodCategoryId);
    await spend('2026-03-05', '600.00', f.foodCategoryId);
    await spend('2026-03-06', '999.00', leisure.id); // not essential
    await spend('2025-12-20', '5000.00', f.foodCategoryId); // last year

    const march = await reports.essentialCost(f.userId, '2026-03-01', null);
    expect(march).toEqual({ month_essential: '600.00', year_average: '300.00', months: 3 });
  });
});
