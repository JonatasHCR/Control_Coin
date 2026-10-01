import { describe, expect, it } from 'vitest';

import {
  add,
  allocate,
  formatMoney,
  isMoney,
  money,
  MoneyError,
  parseMoneyInput,
  sub,
  sum,
} from './money.js';

describe('BR26/BR36 — money is exact decimal, never a float', () => {
  it('keeps cents that a float would lose', () => {
    expect(add(money('0.10'), money('0.20'))).toBe('0.30'); // 0.1 + 0.2 !== 0.3 in binary
  });

  it('sums a long series without drift', () => {
    const cents = Array.from({ length: 1000 }, () => money('0.01'));
    expect(sum(cents)).toBe('10.00');
  });

  it('rejects anything that is not a decimal string', () => {
    expect(() => money('abc')).toThrow(MoneyError);
    expect(() => money('')).toThrow(MoneyError);
    expect(() => money('1,50')).toThrow(MoneyError); // locale input goes through parseMoneyInput
  });

  it('always carries two fraction digits', () => {
    expect(money('5')).toBe('5.00');
    expect(money('5.1')).toBe('5.10');
    expect(isMoney('5.00')).toBe(true);
    expect(isMoney('5.0')).toBe(false);
  });
});

describe('BR12 — split parts sum exactly to the total', () => {
  it('splits the R$ 500 purchase across two cards', () => {
    expect(sum([money('300.00'), money('200.00')])).toBe('500.00');
  });

  it('allocates an indivisible amount without losing a cent', () => {
    const parts = allocate(money('100.00'), 3);
    expect(parts).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(parts)).toBe('100.00');
  });

  it('allocates the 3× R$ 100,00 installment plan evenly', () => {
    expect(allocate(money('300.00'), 3)).toEqual(['100.00', '100.00', '100.00']);
  });

  it('refuses a nonsense part count', () => {
    expect(() => allocate(money('10.00'), 0)).toThrow(MoneyError);
  });
});

describe('BR34 — closing = opening + income − expenses', () => {
  it('carries June into July as the worked example does', () => {
    const opening = money('50.00');
    const closing = sub(add(opening, money('100.00')), money('50.00'));
    expect(closing).toBe('100.00');
  });

  it('carries a negative closing forward unchanged', () => {
    expect(sub(money('20.00'), money('50.00'))).toBe('-30.00');
  });
});

describe('BR30 — language sets formatting, never currency', () => {
  it('writes the same BRL amount differently per locale', () => {
    expect(formatMoney(money('1234.56'), 'BRL', 'pt-BR')).toMatch(/1\.234,56/);
    expect(formatMoney(money('1234.56'), 'BRL', 'en')).toMatch(/1,234\.56/);
  });

  it('keeps the currency the account owns, whatever the locale', () => {
    expect(formatMoney(money('10.00'), 'BRL', 'en')).toContain('R$');
    expect(formatMoney(money('10.00'), 'USD', 'pt-BR')).toContain('US$');
  });

  it('parses input by the active locale', () => {
    expect(parseMoneyInput('1.234,56', 'pt-BR')).toBe('1234.56');
    expect(parseMoneyInput('1,234.56', 'en')).toBe('1234.56');
    expect(parseMoneyInput('R$ 1.234,56', 'pt-BR')).toBe('1234.56');
  });

  it('rejects an ambiguous amount rather than guessing', () => {
    expect(() => parseMoneyInput('1,23,45', 'en')).toThrow(MoneyError);
  });
});
