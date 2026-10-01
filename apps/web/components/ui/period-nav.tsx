'use client';

import { useRouter } from 'next/navigation';

import type { Locale } from '@/lib/i18n';

/**
 * Period lives in the URL, not in React state (ARCH06) — so a view is linkable,
 * the back button works, and server components read it directly.
 *
 * The month and year are direct dropdowns, not only step arrows: jumping two
 * years out is one click, not twenty-four. The arrows stay for stepping one
 * month at a time. `basePath` keeps the navigation on the current screen —
 * without it the arrows on Transactions or Planning would jump to the dashboard.
 */
export function PeriodNav({
  period,
  basePath = '/',
  locale = 'pt-BR',
}: {
  period: string;
  basePath?: string;
  locale?: Locale;
}) {
  const router = useRouter();
  const [y, m] = period.split('-').map(Number) as [number, number];

  const go = (year: number, month: number): void => {
    router.push(`${basePath}?period=${year}-${String(month).padStart(2, '0')}`);
  };

  const shift = (by: number): void => {
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    go(d.getUTCFullYear(), d.getUTCMonth() + 1);
  };

  const monthName = (i: number): string =>
    new Date(Date.UTC(2021, i, 1)).toLocaleDateString(locale, { month: 'long', timeZone: 'UTC' });

  // A generous, dynamic year range that always contains the selected year.
  const base = new Date().getUTCFullYear();
  const lo = Math.min(base - 6, y);
  const hi = Math.max(base + 5, y);
  const years = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  return (
    <div className="tile flex items-stretch gap-0.5 rounded-full p-0.5">
      <button
        type="button"
        onClick={() => shift(-1)}
        aria-label="mês anterior"
        className="grid place-items-center rounded-full px-2.5 text-[13px] text-[var(--color-muted)] transition hover:bg-[var(--color-well)] hover:text-[var(--color-ink)]"
      >
        ‹
      </button>

      <div className="flex items-center px-1">
        <Picker value={m} onChange={(v) => go(y, v)} ariaLabel="mês" capitalize>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i} value={i + 1}>
              {monthName(i)}
            </option>
          ))}
        </Picker>
        <span className="text-[var(--color-line)]">·</span>
        <Picker value={y} onChange={(v) => go(v, m)} ariaLabel="ano">
          {years.map((year) => (
            <option key={year} value={year}>
              {year}
            </option>
          ))}
        </Picker>
      </div>

      <button
        type="button"
        onClick={() => shift(1)}
        aria-label="próximo mês"
        className="grid place-items-center rounded-full px-2.5 text-[13px] text-[var(--color-muted)] transition hover:bg-[var(--color-well)] hover:text-[var(--color-ink)]"
      >
        ›
      </button>
    </div>
  );
}

/**
 * A native select with the OS arrow removed and one custom caret, so it reads
 * as part of the app rather than as an inherited system control. `color-scheme`
 * (set in globals) still makes the open list match the theme.
 */
function Picker({
  value,
  onChange,
  ariaLabel,
  capitalize = false,
  children,
}: {
  value: number;
  onChange: (v: number) => void;
  ariaLabel: string;
  capitalize?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={ariaLabel}
        className={`cursor-pointer appearance-none rounded bg-transparent py-1.5 pl-2 pr-4 text-[13px] font-semibold text-[var(--color-ink)] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--color-accent-soft)] [&>option]:bg-[var(--color-surface)] [&>option]:font-medium [&>option]:text-[var(--color-ink)] ${
          capitalize ? 'capitalize' : ''
        }`}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute right-1 text-[8px] leading-none text-[var(--color-muted)]">
        ▼
      </span>
    </span>
  );
}
