import { describe, expect, it } from 'vitest';

import { money } from '../money/money.js';
import { createTransactionSchema, splitRemainder } from './transaction.js';

const BUY = '11111111-1111-4111-8111-111111111111';
const FOOD = '22222222-2222-4222-8222-222222222222';
const NUBANK = '33333333-3333-4333-8333-333333333333';
const ITAU = '44444444-4444-4444-8444-444444444444';
const CATEGORY = '55555555-5555-4555-8555-555555555555';

const base = {
  occurredOn: '2026-07-22',
  currency: 'BRL',
  categoryId: CATEGORY,
};

/** The R$ 500 purchase from UC03: R$ 300 on Buy in 3×, R$ 200 on Food. */
const splitExpense = {
  ...base,
  kind: 'EXPENSE' as const,
  occurrenceType: 'INSTALLMENT' as const,
  totalAmount: money('500.00'),
  description: 'Supermarket',
  entries: [
    { side: 'SOURCE' as const, cardId: BUY, cardFunction: 'CREDIT' as const, amount: money('300.00'), installmentCount: 3 },
    { side: 'SOURCE' as const, cardId: FOOD, cardFunction: 'CREDIT' as const, amount: money('200.00'), installmentCount: 1 },
  ],
};

/** The R$ 700 invoice payment from UC03/UC12: Nubank 450 + Itaú 250. */
const splitTransfer = {
  ...base,
  categoryId: null,
  kind: 'TRANSFER' as const,
  totalAmount: money('700.00'),
  entries: [
    { side: 'SOURCE' as const, accountId: NUBANK, amount: money('450.00') },
    { side: 'SOURCE' as const, accountId: ITAU, amount: money('250.00') },
    { side: 'DESTINATION' as const, cardId: BUY, cardFunction: 'CREDIT' as const, amount: money('700.00') },
  ],
};

describe('BR12 — split parts must sum exactly to the transaction total', () => {
  it('accepts the R$ 500 expense split across two cards', () => {
    expect(createTransactionSchema.safeParse(splitExpense).success).toBe(true);
  });

  it('rejects parts that fall short of the total', () => {
    const short = {
      ...splitExpense,
      entries: [{ ...splitExpense.entries[0]!, amount: money('100.00') }, splitExpense.entries[1]!],
    };
    const result = createTransactionSchema.safeParse(short);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('BR12');
  });

  it('rejects parts that exceed the total', () => {
    const over = {
      ...splitExpense,
      entries: [{ ...splitExpense.entries[0]!, amount: money('400.00') }, splitExpense.entries[1]!],
    };
    expect(createTransactionSchema.safeParse(over).success).toBe(false);
  });

  it('accepts a transfer split on the source side only', () => {
    expect(createTransactionSchema.safeParse(splitTransfer).success).toBe(true);
  });

  it('rejects a transfer split on both sides at once', () => {
    const both = {
      ...splitTransfer,
      entries: [
        { side: 'SOURCE' as const, accountId: NUBANK, amount: money('350.00') },
        { side: 'SOURCE' as const, accountId: ITAU, amount: money('350.00') },
        { side: 'DESTINATION' as const, cardId: BUY, cardFunction: 'CREDIT' as const, amount: money('350.00') },
        { side: 'DESTINATION' as const, cardId: FOOD, cardFunction: 'CREDIT' as const, amount: money('350.00') },
      ],
    };
    const result = createTransactionSchema.safeParse(both);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('only one side');
  });
});

describe('BR31 — a transfer is never funded by a credit function', () => {
  it('rejects paying an invoice with credit', () => {
    const debtPaysDebt = {
      ...splitTransfer,
      entries: [
        { side: 'SOURCE' as const, cardId: FOOD, cardFunction: 'CREDIT' as const, amount: money('700.00') },
        { side: 'DESTINATION' as const, cardId: BUY, cardFunction: 'CREDIT' as const, amount: money('700.00') },
      ],
    };
    const result = createTransactionSchema.safeParse(debtPaysDebt);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('BR31');
  });

  it('accepts paying an invoice by debit', () => {
    const byDebit = {
      ...splitTransfer,
      entries: [
        { side: 'SOURCE' as const, cardId: BUY, cardFunction: 'DEBIT' as const, amount: money('700.00') },
        { side: 'DESTINATION' as const, cardId: FOOD, cardFunction: 'CREDIT' as const, amount: money('700.00') },
      ],
    };
    expect(createTransactionSchema.safeParse(byDebit).success).toBe(true);
  });
});

describe('BR11 — an entry names exactly one source', () => {
  it('rejects an entry with neither an account nor a card', () => {
    const orphan = {
      ...splitExpense,
      totalAmount: money('10.00'),
      occurrenceType: 'OCCASIONAL' as const,
      entries: [{ side: 'SOURCE' as const, amount: money('10.00') }],
    };
    expect(createTransactionSchema.safeParse(orphan).success).toBe(false);
  });

  it('rejects a card entry with no function', () => {
    const noFunction = {
      ...splitExpense,
      totalAmount: money('10.00'),
      occurrenceType: 'OCCASIONAL' as const,
      entries: [{ side: 'SOURCE' as const, cardId: BUY, amount: money('10.00') }],
    };
    expect(createTransactionSchema.safeParse(noFunction).success).toBe(false);
  });
});

describe('BR01 — a category is optional', () => {
  it('accepts a transaction with no category', () => {
    const uncategorized = { ...splitExpense, categoryId: null };
    expect(createTransactionSchema.safeParse(uncategorized).success).toBe(true);
  });
});

describe('BR10 — occurrence type and shape must agree', () => {
  it('rejects installments on an occasional transaction', () => {
    const wrong = { ...splitExpense, occurrenceType: 'OCCASIONAL' as const };
    const result = createTransactionSchema.safeParse(wrong);
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('BR10');
  });

  it('rejects a recurring transaction with no frequency', () => {
    const wrong = {
      ...splitExpense,
      occurrenceType: 'RECURRING' as const,
      entries: [{ ...splitExpense.entries[0]!, installmentCount: 1 }, splitExpense.entries[1]!],
    };
    expect(createTransactionSchema.safeParse(wrong).success).toBe(false);
  });
});

describe('splitRemainder — what the editor shows while typing', () => {
  it('reports what is still unallocated', () => {
    expect(splitRemainder(money('500.00'), [{ amount: money('300.00') }])).toBe('200.00');
  });

  it('reaches zero when the split balances', () => {
    expect(
      splitRemainder(money('500.00'), [{ amount: money('300.00') }, { amount: money('200.00') }]),
    ).toBe('0.00');
  });

  it('goes negative when over-allocated', () => {
    expect(
      splitRemainder(money('500.00'), [{ amount: money('400.00') }, { amount: money('200.00') }]),
    ).toBe('-100.00');
  });
});
