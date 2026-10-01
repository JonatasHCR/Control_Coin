/**
 * Brazilian business days, computed — never fetched.
 *
 * BR28 leaves the system with no outbound channel, so a holiday API is not an
 * option. The national calendar is fully derivable: eight fixed dates, four
 * that hang off Easter, and Consciência Negra, national from 2024 (Lei
 * 14.759/2023). State and municipal holidays are deliberately NOT here — the
 * system cannot know where the user banks.
 *
 * Dates are ISO `YYYY-MM-DD` strings throughout and every calculation runs in
 * UTC, so a machine in any timezone lands on the same day.
 */

const MS_PER_DAY = 86_400_000;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parse(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/**
 * Easter Sunday by the anonymous Gregorian algorithm — Carnival, Good Friday
 * and Corpus Christi are all offsets from it.
 */
function easter(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function shift(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

const cache = new Map<number, Set<string>>();

/** Every national holiday in a year, as ISO dates. */
export function nationalHolidays(year: number): Set<string> {
  const cached = cache.get(year);
  if (cached) return cached;

  const fixed = ['01-01', '04-21', '05-01', '09-07', '10-12', '11-02', '11-15', '12-25'];
  // Consciência Negra is national only from 2024 onward.
  if (year >= 2024) fixed.push('11-20');

  const days = new Set(fixed.map((d) => `${year}-${d}`));

  const sunday = easter(year);
  days.add(iso(shift(sunday, -48))); // Carnival Monday
  days.add(iso(shift(sunday, -47))); // Carnival Tuesday
  days.add(iso(shift(sunday, -2))); // Good Friday
  days.add(iso(shift(sunday, 60))); // Corpus Christi

  cache.set(year, days);
  return days;
}

export function isBusinessDay(date: string): boolean {
  const d = parse(date);
  const weekday = d.getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  return !nationalHolidays(d.getUTCFullYear()).has(date);
}

/**
 * The first business day on or after `date`. A due date landing on a Saturday
 * moves to Monday, which is what the bank does — it never moves backwards,
 * because that would make money leave earlier than the user agreed.
 */
export function nextBusinessDay(date: string): string {
  let current = parse(date);
  // A run of weekend plus holidays is short; the cap only stops a bad input
  // from looping forever.
  for (let guard = 0; guard < 30; guard += 1) {
    const candidate = iso(current);
    if (isBusinessDay(candidate)) return candidate;
    current = shift(current, 1);
  }
  return date;
}

/**
 * The nth business day of a month — "salary on the fifth business day".
 * `n` counts from 1; a month never has more than 23, so an n beyond the month
 * yields its last business day rather than spilling into the next.
 */
export function nthBusinessDay(year: number, month: number, n: number): string {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  let seen = 0;
  let last = '';

  for (let day = 1; day <= lastDay; day += 1) {
    const candidate = iso(new Date(Date.UTC(year, month - 1, day)));
    if (!isBusinessDay(candidate)) continue;
    last = candidate;
    seen += 1;
    if (seen === n) return candidate;
  }
  return last;
}
