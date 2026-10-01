/**
 * Period and wallet scope — shared because the web app reads them from the URL
 * and the API reads them from query params (BR16, BR19, BR34).
 *
 * Every function here takes `today` explicitly: no module in this package ever
 * calls `new Date()`, so tests can pin the clock (ARCH02).
 */

export type Granularity = 'day' | 'month' | 'year';

export interface Period {
  granularity: Granularity;
  /** ISO date; the first day of the period for month and year. */
  start: string;
}

export type WalletScope = 'all' | { walletIds: string[]; includeUnassigned: boolean };

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (s: string) => new Date(`${s}T00:00:00Z`);

export function currentPeriod(today: string, granularity: Granularity = 'month'): Period {
  return { granularity, start: startOf(today, granularity) };
}

export function startOf(date: string, granularity: Granularity): string {
  const d = utc(date);
  if (granularity === 'day') return iso(d);
  if (granularity === 'month') return `${date.slice(0, 7)}-01`;
  return `${date.slice(0, 4)}-01-01`;
}

export function endOf(period: Period): string {
  const d = utc(period.start);
  if (period.granularity === 'day') return iso(d);
  if (period.granularity === 'month') {
    return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
  }
  return `${period.start.slice(0, 4)}-12-31`;
}

export function shift(period: Period, by: number): Period {
  const d = utc(period.start);
  const next =
    period.granularity === 'day'
      ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + by))
      : period.granularity === 'month'
        ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + by, 1))
        : new Date(Date.UTC(d.getUTCFullYear() + by, 0, 1));
  return { granularity: period.granularity, start: iso(next) };
}

export const previous = (p: Period): Period => shift(p, -1);
export const next = (p: Period): Period => shift(p, 1);

/** Keep the user near where they were when granularity changes. */
export function withGranularity(period: Period, granularity: Granularity): Period {
  return { granularity, start: startOf(period.start, granularity) };
}

/**
 * BR19: a period after the current one shows commitments only. BR14: the
 * running period is never complete, so it never feeds an average.
 */
export function isFuture(period: Period, today: string): boolean {
  return period.start > startOf(today, period.granularity);
}

export function isCurrent(period: Period, today: string): boolean {
  return period.start === startOf(today, period.granularity);
}

export function isComplete(period: Period, today: string): boolean {
  return endOf(period) < today;
}

/** `?period=2026-07&granularity=month&scope=all` ⇄ typed values. */
export function periodToParams(period: Period, scope: WalletScope): URLSearchParams {
  const params = new URLSearchParams();
  params.set('granularity', period.granularity);
  params.set(
    'period',
    period.granularity === 'year'
      ? period.start.slice(0, 4)
      : period.granularity === 'month'
        ? period.start.slice(0, 7)
        : period.start,
  );
  if (scope !== 'all') {
    const ids = [...scope.walletIds];
    if (scope.includeUnassigned) ids.push('none');
    params.set('scope', ids.join(','));
  }
  return params;
}

export function periodFromParams(
  params: URLSearchParams | Record<string, string | undefined>,
  today: string,
): { period: Period; scope: WalletScope } {
  const get = (k: string) =>
    params instanceof URLSearchParams ? params.get(k) : (params[k] ?? null);

  const granularity = (get('granularity') ?? 'month') as Granularity;
  const raw = get('period');
  const period: Period = raw
    ? {
        granularity,
        start: startOf(
          raw.length === 4 ? `${raw}-01-01` : raw.length === 7 ? `${raw}-01` : raw,
          granularity,
        ),
      }
    : currentPeriod(today, granularity);

  const rawScope = get('scope');
  const scope: WalletScope =
    !rawScope || rawScope === 'all'
      ? 'all'
      : {
          walletIds: rawScope.split(',').filter((id: string) => id !== '' && id !== 'none'),
          includeUnassigned: rawScope.split(',').includes('none'),
        };

  return { period, scope };
}
