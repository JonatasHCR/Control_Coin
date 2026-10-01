import { describe, expect, it } from 'vitest';

import { money, sum } from '../money/money.js';
import { addMonths, invoiceCycleDates, invoiceReferenceMonth, planSettlements } from './settlement-plan.js';

describe('BR10 — an entry expands into the movements it will produce', () => {
  it('makes one settlement for an occasional charge', () => {
    const plan = planSettlements(
      { amount: money('200.00'), installmentCount: 1, cardFunction: 'CREDIT' },
      '2026-07-22',
      '2026-08-05',
    );
    expect(plan).toEqual([
      { sequenceNo: 1, amount: '200.00', dueOn: '2026-08-05', needsInvoice: true },
    ]);
  });

  it('dates the 3x R$ 100,00 plan forward month by month', () => {
    const plan = planSettlements(
      { amount: money('300.00'), installmentCount: 3, cardFunction: 'CREDIT' },
      '2026-07-22',
      '2026-08-05',
    );
    expect(plan.map((p) => p.dueOn)).toEqual(['2026-08-05', '2026-09-05', '2026-10-05']);
    expect(plan.map((p) => p.amount)).toEqual(['100.00', '100.00', '100.00']);
  });

  it('never loses a cent on an indivisible plan (BR12)', () => {
    const plan = planSettlements(
      { amount: money('100.00'), installmentCount: 3, cardFunction: 'CREDIT' },
      '2026-07-22',
    );
    expect(sum(plan.map((p) => p.amount))).toBe('100.00');
  });

  it('clamps a day that does not exist in the target month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
  });
});

describe('BR07 — only credit charges need an invoice', () => {
  it('marks credit charges as invoice-bound', () => {
    const [first] = planSettlements(
      { amount: money('10.00'), installmentCount: 1, cardFunction: 'CREDIT' },
      '2026-07-22',
    );
    expect(first?.needsInvoice).toBe(true);
  });

  it('settles debit against the account, with no invoice', () => {
    const [first] = planSettlements(
      { amount: money('42.80'), installmentCount: 1, cardFunction: 'DEBIT' },
      '2026-07-18',
    );
    expect(first).toEqual({
      sequenceNo: 1, amount: '42.80', dueOn: '2026-07-18', needsInvoice: false,
    });
  });

  it('puts a purchase after the closing day on the next cycle', () => {
    expect(invoiceReferenceMonth('2026-07-22', 28)).toBe('2026-07-01');
    expect(invoiceReferenceMonth('2026-07-29', 28)).toBe('2026-08-01');
  });

  it('bills a purchase made ON the closing day to the cycle that opens', () => {
    // Read off a real statement: closing on the 4th, the September invoice
    // covers 04/08 to 03/09.
    expect(invoiceReferenceMonth('2026-08-03', 4)).toBe('2026-08-01');
    expect(invoiceReferenceMonth('2026-08-04', 4)).toBe('2026-09-01');
    expect(invoiceReferenceMonth('2026-09-03', 4)).toBe('2026-09-01');
    expect(invoiceReferenceMonth('2026-09-04', 4)).toBe('2026-10-01');
  });
});

describe('BR07 — the invoice due date follows the closing date', () => {
  it('due day after closing day sits in the same month (close 04, due 11)', () => {
    // BR38: the nominal 11th is a Saturday here, so the bill falls due on the
    // Monday. The closing date does not move.
    expect(invoiceCycleDates('2026-07-01', 4, 11)).toEqual({
      closesOn: '2026-07-04',
      dueOn: '2026-07-13',
    });
  });

  it('leaves a due date that already falls on a business day alone (BR38)', () => {
    expect(invoiceCycleDates('2026-06-01', 4, 11)).toEqual({
      closesOn: '2026-06-04',
      dueOn: '2026-06-11', // a Thursday
    });
  });

  it('due day before closing day rolls to the next month (close 28, due 05)', () => {
    expect(invoiceCycleDates('2026-07-01', 28, 5)).toEqual({
      closesOn: '2026-07-28',
      dueOn: '2026-08-05',
    });
  });

  it('rolls a December close into a January due (close 28, due 05)', () => {
    expect(invoiceCycleDates('2026-12-01', 28, 5)).toEqual({
      closesOn: '2026-12-28',
      dueOn: '2027-01-05',
    });
  });

  it('clamps a closing day past the month length (close 31 in February)', () => {
    expect(invoiceCycleDates('2026-02-01', 31, 5).closesOn).toBe('2026-02-28');
  });
});
