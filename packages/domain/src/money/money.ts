import { Decimal } from 'decimal.js';

/**
 * Money is a decimal string with exactly two fraction digits: "1234.56".
 *
 * BR26/BR36: money is never a JavaScript number. Floats lose cents, and a lost
 * cent in a balance is a bug that never shows up in a demo. The brand makes an
 * accidental `amount + 1` a type error rather than a silent corruption.
 */
export type Money = string & { readonly __brand: 'Money' };

/** Thrown when a value cannot be read as money. Never guesses. */
export class MoneyError extends Error {}

const TWO_DP = /^-?\d+\.\d{2}$/;

/** Build Money from a decimal string, a Decimal, or another Money. */
export function money(value: string | Decimal): Money {
  const d = value instanceof Decimal ? value : new Decimal(assertNumeric(value));
  if (!d.isFinite()) throw new MoneyError(`not a finite amount: ${String(value)}`);
  return d.toFixed(2) as Money;
}

export const ZERO: Money = '0.00' as Money;

function assertNumeric(value: string): string {
  const trimmed = value.trim();
  if (trimmed === '' || !/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new MoneyError(`not a decimal string: ${JSON.stringify(value)}`);
  }
  return trimmed;
}

/** Runtime guard, for parsing values arriving from outside. */
export function isMoney(value: unknown): value is Money {
  return typeof value === 'string' && TWO_DP.test(value);
}

export const toDecimal = (m: Money): Decimal => new Decimal(m);

export const add = (a: Money, b: Money): Money => money(new Decimal(a).plus(b));
export const sub = (a: Money, b: Money): Money => money(new Decimal(a).minus(b));

export function sum(amounts: readonly Money[]): Money {
  return amounts.reduce<Money>((total, m) => add(total, m), ZERO);
}

/** Multiply by an integer count — for `3 × R$ 100,00`, never for rates. */
export const times = (m: Money, factor: number): Money =>
  money(new Decimal(m).times(factor));

export const isZero = (m: Money): boolean => new Decimal(m).isZero();
export const isNegative = (m: Money): boolean => new Decimal(m).isNegative();
export const isPositive = (m: Money): boolean => new Decimal(m).greaterThan(0);
export const equals = (a: Money, b: Money): boolean => new Decimal(a).equals(b);
export const compare = (a: Money, b: Money): -1 | 0 | 1 =>
  new Decimal(a).comparedTo(b) as -1 | 0 | 1;

/**
 * Split an amount into `parts` as evenly as possible, giving the remainder
 * cents to the earliest parts. R$ 100,00 in 3× is 33.34 + 33.33 + 33.33 —
 * the parts always sum back to the original, which BR12 requires.
 */
export function allocate(total: Money, parts: number): Money[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError(`parts must be a positive integer, got ${parts}`);
  }
  const cents = new Decimal(total).times(100).toDecimalPlaces(0);
  const base = cents.dividedToIntegerBy(parts);
  const remainder = cents.minus(base.times(parts)).toNumber();

  return Array.from({ length: parts }, (_, i) =>
    money(base.plus(i < Math.abs(remainder) ? Math.sign(remainder) : 0).dividedBy(100)),
  );
}

/**
 * BR30: the locale decides how an amount is written; the currency belongs to
 * the account. Passing one without the other is how `R$` silently becomes `$`.
 */
export function formatMoney(
  amount: Money,
  currency: string,
  locale: 'pt-BR' | 'en',
): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(Number(amount));
}

/**
 * BR30/BR26: parse user input according to the active locale. "1.234,56" is
 * one thousand in pt-BR and 1.234 in en — so an ambiguous string is rejected
 * rather than guessed, and the caller asks the user.
 */
export function parseMoneyInput(input: string, locale: 'pt-BR' | 'en'): Money {
  const raw = input.trim().replace(/\s|R\$|[A-Za-z$€£]/g, '');
  if (raw === '') throw new MoneyError('empty amount');

  const [group, decimal] = locale === 'pt-BR' ? ['.', ','] : [',', '.'];

  const parts = raw.split(decimal);
  if (parts.length > 2) throw new MoneyError(`ambiguous amount: ${input}`);

  const [integerPart = '', fractionPart] = parts;
  if (fractionPart !== undefined && !/^\d{1,2}$/.test(fractionPart)) {
    throw new MoneyError(`ambiguous amount: ${input}`);
  }

  // Validate the grouping *before* stripping it: 1.234.567 is valid, 1.23.45 is not.
  const sign = integerPart.startsWith('-') ? '-' : '';
  const digits = sign ? integerPart.slice(1) : integerPart;
  const g = group === '.' ? '\\.' : group;
  const grouped = new RegExp(`^\\d{1,3}(${g}\\d{3})+$`);

  if (digits.includes(group)) {
    if (!grouped.test(digits)) throw new MoneyError(`ambiguous amount: ${input}`);
  } else if (!/^\d+$/.test(digits)) {
    throw new MoneyError(`not a decimal amount: ${input}`);
  }

  const whole = `${sign}${digits.split(group).join('')}`;
  return money(`${whole}.${(fractionPart ?? '').padEnd(2, '0')}`);
}
