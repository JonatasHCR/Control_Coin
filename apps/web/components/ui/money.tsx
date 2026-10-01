import { formatMoney, type Money as MoneyString } from '@cc/domain/money';
import type { Locale } from '@/lib/i18n';

/**
 * The only component that renders an amount.
 *
 * BR30: it takes the amount AND its currency, and reads the locale — a Money
 * component that assumes BRL is a bug waiting for the first foreign account.
 * The value stays a string throughout; nothing here parses it into a number.
 */
export function Money({
  value,
  currency = 'BRL',
  locale = 'pt-BR',
  className = '',
}: {
  value: string;
  currency?: string;
  locale?: Locale;
  className?: string;
}) {
  return (
    <span className={`tabular ${className}`}>
      {formatMoney(value as MoneyString, currency, locale)}
    </span>
  );
}
