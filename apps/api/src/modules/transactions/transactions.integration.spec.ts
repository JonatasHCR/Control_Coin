import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@cc/domain/rules';
import { money } from '@cc/domain/money';

import { DomainError } from '../../common/errors/domain-error.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

let f: Fixture;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

/** UC03 fixture A — R$ 500 split across two cards, R$ 300 of it in 3×. */
const splitExpense = (f: Fixture) => ({
  kind: 'EXPENSE' as const,
  occurrenceType: 'INSTALLMENT' as const,
  categoryId: f.foodCategoryId,
  description: 'Supermarket',
  occurredOn: '2026-07-22',
  totalAmount: money('500.00'),
  currency: 'BRL',
  entries: [
    { side: 'SOURCE' as const, cardId: f.buyCardId, cardFunction: 'CREDIT' as const, amount: money('300.00'), installmentCount: 3 },
    { side: 'SOURCE' as const, cardId: f.foodCardId, cardFunction: 'CREDIT' as const, amount: money('200.00'), installmentCount: 1 },
  ],
});

describe('BR12 — split parts must sum exactly to the transaction total', () => {
  it('writes one transaction, two entries and four settlements', async () => {
    const created = await transactions.create(f.userId, splitExpense(f));

    const entries = await prisma.entry.findMany({
      where: { transactionId: created.id },
      include: { settlements: true },
      orderBy: { amount: 'desc' },
    });

    expect(entries).toHaveLength(2);
    expect(entries.flatMap((e) => e.settlements)).toHaveLength(4);
    expect(entries[0]?.settlements.map((s) => s.amount.toFixed(2))).toEqual([
      '100.00', '100.00', '100.00',
    ]);
  });

  it('is one record for the category and the budget, however it was split', async () => {
    const created = await transactions.create(f.userId, splitExpense(f));
    const rows = await prisma.transaction.findMany({ where: { categoryId: f.foodCategoryId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.totalAmount.toFixed(2)).toBe('500.00');
    expect(created.categoryId).toBe(f.foodCategoryId);
  });

  it('rejects a split whose parts fall short of the total', async () => {
    const short = splitExpense(f);
    short.entries[1]!.amount = money('100.00'); // 300 + 100 ≠ 500

    await expect(transactions.create(f.userId, short)).rejects.toBeInstanceOf(DomainError);
    expect(await prisma.transaction.count()).toBe(0); // nothing half-written
  });

  it('rejects a transfer split on both sides at once', async () => {
    await expect(
      transactions.create(f.userId, {
        kind: 'TRANSFER',
        occurrenceType: 'OCCASIONAL',
        categoryId: null,
        occurredOn: '2026-07-20',
        totalAmount: money('700.00'),
        currency: 'BRL',
        entries: [
          { side: 'SOURCE', accountId: f.nubankId, amount: money('350.00') },
          { side: 'SOURCE', accountId: f.itauId, amount: money('350.00') },
          { side: 'DESTINATION', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('350.00') },
          { side: 'DESTINATION', cardId: f.foodCardId, cardFunction: 'CREDIT', amount: money('350.00') },
        ],
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('BR07 — settlement follows the function used', () => {
  it('accumulates a credit charge on an invoice, leaving the account untouched', async () => {
    await transactions.create(f.userId, splitExpense(f));

    const settlements = await prisma.settlement.findMany({ where: { invoiceId: { not: null } } });
    expect(settlements).toHaveLength(4);
    expect(settlements.every((s) => s.settledOn === null)).toBe(true); // owed, not paid

    const [balance] = await prisma.$queryRaw<{ balance: string }[]>`
      SELECT balance::text FROM v_account_balance WHERE account_id = ${f.nubankId}::uuid`;
    expect(Number(balance?.balance)).toBe(10000); // BR07: unchanged by a credit purchase
  });

  it('settles a debit purchase against the parent account immediately', async () => {
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      description: 'Uber',
      occurredOn: '2026-07-18',
      totalAmount: money('42.80'),
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'DEBIT', amount: money('42.80') },
      ],
    });

    const settlement = await prisma.settlement.findFirstOrThrow();
    expect(settlement.invoiceId).toBeNull();
    expect(settlement.settledOn).not.toBeNull();
  });

  it('spreads an installment plan across consecutive invoices', async () => {
    await transactions.create(f.userId, splitExpense(f));
    const invoices = await prisma.invoice.findMany({
      where: { cardId: f.buyCardId },
      orderBy: { referenceMonth: 'asc' },
    });
    expect(invoices.map((i) => i.referenceMonth.toISOString().slice(0, 7))).toEqual([
      '2026-07', '2026-08', '2026-09',
    ]);
  });
});

describe('BR09 — the function used must be one the card enables', () => {
  it('rejects debit on a credit-only card', async () => {
    await expect(
      transactions.create(f.userId, {
        kind: 'EXPENSE',
        occurrenceType: 'OCCASIONAL',
        categoryId: null,
        occurredOn: '2026-07-20',
        totalAmount: money('50.00'),
        currency: 'BRL',
        entries: [
          { side: 'SOURCE', cardId: f.foodCardId, cardFunction: 'DEBIT', amount: money('50.00') },
        ],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.CARD_FUNCTION_DISABLED });
  });
});

describe('BR31 — a transfer is never funded by a credit function', () => {
  it('rejects debt paying debt', async () => {
    await expect(
      transactions.create(f.userId, {
        kind: 'TRANSFER',
        occurrenceType: 'OCCASIONAL',
        categoryId: null,
        occurredOn: '2026-08-02',
        totalAmount: money('700.00'),
        currency: 'BRL',
        entries: [
          { side: 'SOURCE', cardId: f.foodCardId, cardFunction: 'CREDIT', amount: money('700.00') },
          { side: 'DESTINATION', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('700.00') },
        ],
      }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});

describe('BR01 — a category is optional', () => {
  it('stores a transaction with none, as Uncategorized', async () => {
    const created = await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      description: 'Pharmacy',
      occurredOn: '2026-07-15',
      totalAmount: money('96.00'),
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: f.foodCardId, cardFunction: 'CREDIT', amount: money('96.00') },
      ],
    });
    expect(created.categoryId).toBeNull();
  });
});

describe('BR03/BR34 — a transfer moves money without changing net worth', () => {
  it('debits two accounts and leaves the total untouched', async () => {
    const before = await netWorth();

    await transactions.create(f.userId, {
      kind: 'TRANSFER',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      description: 'Buy invoice payment',
      occurredOn: '2026-08-02',
      totalAmount: money('700.00'),
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', accountId: f.nubankId, amount: money('450.00') },
        { side: 'SOURCE', accountId: f.itauId, amount: money('250.00') },
        { side: 'DESTINATION', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('700.00') },
      ],
    });

    const [nubank] = await prisma.$queryRaw<{ balance: string }[]>`
      SELECT balance::text FROM v_account_balance WHERE account_id = ${f.nubankId}::uuid`;
    const [itau] = await prisma.$queryRaw<{ balance: string }[]>`
      SELECT balance::text FROM v_account_balance WHERE account_id = ${f.itauId}::uuid`;

    expect(Number(nubank?.balance)).toBe(9550); // 10000 − 450
    expect(Number(itau?.balance)).toBe(4750); //  5000 − 250
    expect(before - (await netWorth())).toBe(700); // left the accounts, sits on the card
  });
});

async function netWorth(): Promise<number> {
  const rows = await prisma.$queryRaw<{ total: string }[]>`
    SELECT COALESCE(SUM(balance), 0)::text AS total FROM v_account_balance`;
  return Number(rows[0]?.total ?? 0);
}
