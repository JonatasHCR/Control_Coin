import { z } from 'zod';

import { add, isMoney, isZero, sub, sum, type Money, ZERO } from '../money/money.js';
import { RULES } from '../rules/rules.js';

/** A money string, validated at the boundary. */
export const moneySchema = z
  .string()
  .refine(isMoney, { message: 'expected an amount like "1234.56"' })
  .transform((v) => v as Money);

export const positiveMoneySchema = moneySchema.refine(
  (m) => !isZero(m) && !m.startsWith('-'),
  { message: 'amount must be greater than zero' },
);

export const transactionKind = z.enum(['INCOME', 'EXPENSE', 'TRANSFER']);
export const occurrenceType = z.enum(['OCCASIONAL', 'RECURRING', 'INSTALLMENT']);
export const entrySide = z.enum(['SOURCE', 'DESTINATION']);
export const cardFunction = z.enum(['CREDIT', 'DEBIT']);
export const frequency = z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']);

export type TransactionKind = z.infer<typeof transactionKind>;
export type CardFunction = z.infer<typeof cardFunction>;

/**
 * BR11: an entry names exactly one source — an account, or a card plus the
 * function used. Expressed as a union so an entry with both, or neither, is
 * unrepresentable rather than merely rejected.
 */
const accountEntry = z.object({
  accountId: z.string().uuid(),
  cardId: z.never().optional(),
  cardFunction: z.never().optional(),
});

const cardEntry = z.object({
  accountId: z.never().optional(),
  cardId: z.string().uuid(),
  cardFunction,
});

export const entrySchema = z
  .intersection(
    z.object({
      side: entrySide,
      amount: positiveMoneySchema,
      installmentCount: z.number().int().min(1).max(120).default(1),
    }),
    z.union([accountEntry, cardEntry]),
  )
  .describe(RULES.BR11);

export type EntryInput = z.infer<typeof entrySchema>;

const baseTransaction = z.object({
  kind: transactionKind,
  occurrenceType: occurrenceType.default('OCCASIONAL'),
  categoryId: z.string().uuid().nullable().default(null), // BR01: optional
  description: z.string().trim().max(200).optional(),
  occurredOn: z.string().date(),
  totalAmount: positiveMoneySchema,
  currency: z.string().length(3),
  entries: z.array(entrySchema).min(1),
  recurrence: z
    .object({
      frequency,
      intervalCount: z.number().int().min(1).default(1),
      endsOn: z.string().date().nullable().default(null),
    })
    .optional(),
});

const sideTotal = (entries: readonly EntryInput[], side: 'SOURCE' | 'DESTINATION'): Money =>
  sum(entries.filter((e) => e.side === side).map((e) => e.amount));

export const createTransactionSchema = baseTransaction
  // BR12 — the parts must sum exactly to the total.
  .superRefine((tx, ctx) => {
    const source = sideTotal(tx.entries, 'SOURCE');
    const destination = sideTotal(tx.entries, 'DESTINATION');
    const sourceCount = tx.entries.filter((e) => e.side === 'SOURCE').length;
    const destinationCount = tx.entries.length - sourceCount;

    const fail = (message: string, path: (string | number)[] = ['entries']) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (tx.kind === 'EXPENSE') {
      if (destinationCount > 0) fail('an expense has source entries only');
      if (source !== tx.totalAmount) {
        fail(`${RULES.BR12} — sources total ${source}, expected ${tx.totalAmount}`);
      }
    }

    if (tx.kind === 'INCOME') {
      if (sourceCount > 0) fail('an income has destination entries only');
      if (destination !== tx.totalAmount) {
        fail(`${RULES.BR12} — destinations total ${destination}, expected ${tx.totalAmount}`);
      }
    }

    if (tx.kind === 'TRANSFER') {
      if (sourceCount === 0 || destinationCount === 0) {
        fail('a transfer needs a source and a destination');
      }
      if (source !== tx.totalAmount || destination !== tx.totalAmount) {
        fail(`${RULES.BR12} — both sides of a transfer must total ${tx.totalAmount}`);
      }
      // BR12 — only one side may be split, so the mapping stays unambiguous.
      if (sourceCount > 1 && destinationCount > 1) {
        fail('a transfer may be split on only one side');
      }
      // BR31 — debt cannot pay debt.
      if (tx.entries.some((e) => e.side === 'SOURCE' && e.cardFunction === 'CREDIT')) {
        fail(RULES.BR31, ['entries']);
      }
    }
  })
  // BR10 — occurrence type and its shape must agree.
  .superRefine((tx, ctx) => {
    const fail = (message: string, path: (string | number)[]) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (tx.occurrenceType === 'RECURRING' && !tx.recurrence) {
      fail('a recurring transaction needs a frequency', ['recurrence']);
    }
    if (tx.occurrenceType !== 'RECURRING' && tx.recurrence) {
      fail('only a recurring transaction carries a frequency', ['recurrence']);
    }
    if (
      tx.occurrenceType !== 'INSTALLMENT' &&
      tx.entries.some((e) => e.installmentCount > 1)
    ) {
      fail(RULES.BR10, ['entries']);
    }
  });

export type CreateTransactionInput = z.input<typeof createTransactionSchema>;
export type CreateTransaction = z.output<typeof createTransactionSchema>;

/** Live remainder for the split editor — the frontend computes this per keystroke. */
export function splitRemainder(
  total: Money,
  parts: readonly { amount: Money }[],
): Money {
  return sub(total, parts.reduce<Money>((acc, p) => add(acc, p.amount), ZERO));
}
