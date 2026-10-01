import { nextBusinessDay } from '../calendar/business-days.js';

import { allocate, type Money } from '../money/money.js';
import type { EntryInput } from './transaction.js';

/**
 * Expanding an entry into the movements of money it will actually produce.
 *
 * BR10: occasional → one settlement; installment → N, dated forward monthly.
 * BR12: the parts always sum back to the entry amount, which the deferred
 * database trigger re-checks at COMMIT.
 *
 * Pure, and takes every date explicitly — so it is unit-testable without a
 * database and without a clock (ARCH02).
 */
export interface PlannedSettlement {
  sequenceNo: number;
  amount: Money;
  dueOn: string;
  /** Credit charges land on an invoice; debit and direct settlements do not (BR07). */
  needsInvoice: boolean;
}

/** Add whole months to an ISO date, clamping to the last day of the target month. */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  const day = Math.min(d, lastDay);
  const mm = String(target.getUTCMonth() + 1).padStart(2, '0');
  return `${target.getUTCFullYear()}-${mm}-${String(day).padStart(2, '0')}`;
}

/**
 * The first credit charge falls on the invoice due after the purchase; a debit
 * or direct payment settles on the transaction date itself.
 */
export function planSettlements(
  entry: Pick<EntryInput, 'amount' | 'installmentCount' | 'cardFunction'>,
  occurredOn: string,
  firstDueOn: string = occurredOn,
): PlannedSettlement[] {
  const parts = allocate(entry.amount, entry.installmentCount);
  const needsInvoice = entry.cardFunction === 'CREDIT';

  return parts.map((amount, index) => ({
    sequenceNo: index + 1,
    amount,
    dueOn: index === 0 ? firstDueOn : addMonths(firstDueOn, index),
    needsInvoice,
  }));
}

/** The reference month an amount charged on `chargedOn` belongs to (BR07). */
export function invoiceReferenceMonth(chargedOn: string, closingDay: number): string {
  const [y, m, d] = chargedOn.split('-').map(Number) as [number, number, number];
  // The closing day OPENS the next cycle rather than ending this one: a card
  // closing on the 4th bills 04/08–03/09 on the September invoice, so a
  // purchase made ON the 4th is already the next cycle's. Using `>` here put
  // every purchase dated exactly on the closing day one invoice too early.
  const shift = d >= closingDay ? 1 : 0;
  const ref = new Date(Date.UTC(y, m - 1 + shift, 1));
  return `${ref.getUTCFullYear()}-${String(ref.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

/**
 * The closing and due dates of the invoice for a reference month (BR07).
 *
 * The due day always falls *after* the closing day in time. When the due day is
 * the later of the two within a month — closes the 4th, due the 11th — both sit
 * in the reference month. When it is not — closes the 28th, due the 5th — the
 * due date rolls into the following month, because you cannot be billed to pay
 * before the cycle has even closed. Getting this wrong dates every invoice a
 * month off for any card whose due day is after its closing day.
 */
export function invoiceCycleDates(
  referenceMonth: string,
  closingDay: number,
  dueDay: number,
): { closesOn: string; dueOn: string } {
  const [y, m] = referenceMonth.split('-').map(Number) as [number, number];
  const closesOn = clampedDate(y, m - 1, closingDay);
  const dueShift = dueDay > closingDay ? 0 : 1;
  const nominal = clampedDate(y, m - 1 + dueShift, dueDay);
  // BR38: a bill is not due on a day the bank is shut — it moves forward, the
  // way the bank itself moves it. Only the due date shifts; the statement
  // still closes on its own day.
  return { closesOn, dueOn: nextBusinessDay(nominal) };
}

/** An ISO date, clamping the day to the target month's length (BR07 — a card
 *  closing on the 31st still closes in February, on the 28th or 29th). */
function clampedDate(year: number, monthIndex: number, day: number): string {
  const base = new Date(Date.UTC(year, monthIndex, 1));
  const y = base.getUTCFullYear();
  const mi = base.getUTCMonth();
  const lastDay = new Date(Date.UTC(y, mi + 1, 0)).getUTCDate();
  const d = Math.min(day, lastDay);
  return `${y}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
