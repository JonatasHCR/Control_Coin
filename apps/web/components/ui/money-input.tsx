'use client';

import { displayMoney, maskMoney } from '@/lib/money-input';

/**
 * A money field that accepts what a pt-BR keyboard types — comma and all —
 * and tidies itself into `1.234,56` when it loses focus. The value it holds
 * stays a display string; `toApiMoney` converts at the moment of sending, so
 * nothing here ever becomes a float (BR26).
 */
export function MoneyInput({
  value,
  onChange,
  className,
  placeholder,
}: {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <input
      value={value}
      inputMode="decimal"
      placeholder={placeholder}
      onChange={(event) => onChange(maskMoney(event.target.value))}
      onBlur={() => onChange(displayMoney(value))}
      className={className}
    />
  );
}
