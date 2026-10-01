'use client';

import { useRouter, useSearchParams } from 'next/navigation';

/**
 * Month, whole year, or an explicit range.
 *
 * The month stays the default because that is the period every other figure in
 * the app is built around (BR19); the wider spans are for looking back, not for
 * replacing it. Choosing a span rewrites the URL (ARCH06), so a year's view is
 * as linkable as a month's.
 */
export function PeriodRange({
  period,
  labels,
}: {
  period: string;
  labels: { month: string; year: string; range: string; from: string; to: string };
}) {
  const router = useRouter();
  const params = useSearchParams();

  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const mode = from || to ? (isWholeYear(from, to) ? 'year' : 'range') : 'month';

  const push = (next: URLSearchParams): void => router.push(`/transactions?${next.toString()}`);

  const choose = (which: 'month' | 'year' | 'range'): void => {
    const query = new URLSearchParams(params.toString());
    const year = (from || `${period}-01`).slice(0, 4);
    if (which === 'month') {
      query.delete('from');
      query.delete('to');
    } else if (which === 'year') {
      query.set('from', `${year}-01-01`);
      query.set('to', `${year}-12-31`);
    } else {
      query.set('from', from || `${period}-01`);
      query.set('to', to || `${period}-28`);
    }
    push(query);
  };

  const setBound = (key: 'from' | 'to', value: string): void => {
    const query = new URLSearchParams(params.toString());
    if (value === '') query.delete(key);
    else query.set(key, value);
    push(query);
  };

  const tab = (which: 'month' | 'year' | 'range', label: string) => (
    <button
      type="button"
      onClick={() => choose(which)}
      className={`rounded-full px-3 py-1 text-[11.5px] transition ${
        mode === which ? 'bg-[var(--color-surface)] font-semibold shadow-sm' : 'text-[var(--color-muted)]'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-0.5 rounded-full bg-[var(--color-inset)] p-0.5">
        {tab('month', labels.month)}
        {tab('year', labels.year)}
        {tab('range', labels.range)}
      </div>

      {mode !== 'month' ? (
        <div className="flex items-center gap-1.5">
          <input
            type="date"
            value={from}
            onChange={(event) => setBound('from', event.target.value)}
            aria-label={labels.from}
            className="rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1 text-[12px] outline-none"
          />
          <span className="text-[var(--color-muted)]">→</span>
          <input
            type="date"
            value={to}
            onChange={(event) => setBound('to', event.target.value)}
            aria-label={labels.to}
            className="rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1 text-[12px] outline-none"
          />
        </div>
      ) : null}
    </div>
  );
}

function isWholeYear(from: string, to: string): boolean {
  return (
    from.length === 10 &&
    to.length === 10 &&
    from.slice(0, 4) === to.slice(0, 4) &&
    from.slice(5) === '01-01' &&
    to.slice(5) === '12-31'
  );
}
