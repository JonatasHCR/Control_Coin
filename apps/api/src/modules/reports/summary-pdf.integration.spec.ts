import { beforeEach, describe, expect, it } from 'vitest';

import { ReportsRepository } from './reports.repository.js';
import { SummaryPdfService } from './summary-pdf.service.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const pdf = new SummaryPdfService(new ReportsRepository(prisma as never), prisma as never);

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

describe('UC07 — monthly summary PDF', () => {
  it('renders a PDF even for a month with no movement', async () => {
    const buffer = await pdf.render(f.userId, '2026-07-01', '2026-07-31');
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
  });
});

describe('UC07 — a date range agrees with the monthly report', () => {
  it('a whole-month range gives the same balance as period_balance', async () => {
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: f.foodCategoryId,
      description: 'Mercado',
      occurredOn: '2026-07-10',
      totalAmount: '300.00',
      currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.itauId, amount: '300.00' }],
    } as never);

    const month = await new ReportsRepository(prisma as never).periodBalance(f.userId, '2026-07-01', null);
    const [range] = await (pdf as never as { balance: (u: string, a: string, b: string) => Promise<Record<string, string>[]> })
      .balance(f.userId, '2026-07-01', '2026-07-31');
    expect(Number(range!.income)).toBe(Number(month!.income));
    expect(Number(range!.expenses)).toBe(Number(month!.expenses));
    expect(Number(range!.closing_balance)).toBe(Number(month!.closing_balance));
  });
});
