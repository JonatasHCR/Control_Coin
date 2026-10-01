import { Chip } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { t, type Locale } from '@/lib/i18n';
import type { TransactionRow } from '@/lib/api';

type Entry = TransactionRow['entries'][number];

const COLS = 'grid grid-cols-[62px_minmax(150px,1fr)_130px_150px_150px_110px] gap-x-2';

/**
 * The month's ledger, with the three-level spine opened in place: a split or
 * instalment purchase shows one row per ENTRY under the transaction, with the
 * months it settles in beside it. Reading "R$ 500 · 2 cartões · 3×" off one
 * line is what makes BR11/BR12 legible without opening anything.
 */
export function Ledger({ rows, locale }: { rows: TransactionRow[]; locale: Locale }) {
  const movements = rows.reduce(
    (n, r) => n + r.entries.reduce((m, e) => m + Math.max(e.settlements.length, 1), 0),
    0,
  );

  return (
    <section className="tile overflow-hidden">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
        <h2 className="text-[14px] font-semibold">{t(locale, 'tx.title')}</h2>
        <span className="text-[11.5px] text-[var(--color-muted)]">
          {rows.length} {t(locale, 'tx.events')} · {movements} {t(locale, 'tx.movements')}
        </span>
      </header>

      {/* The table is the one thing allowed to scroll sideways on a phone. */}
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className={`${COLS} border-y border-[var(--color-line)] bg-[var(--color-well)] px-4 py-1.5`}>
            <span className="label">{t(locale, 'col.date')}</span>
            <span className="label">{t(locale, 'col.description')}</span>
            <span className="label">{t(locale, 'col.category')}</span>
            <span className="label">{t(locale, 'col.paidWith')}</span>
            <span className="label">{t(locale, 'col.settlesOn')}</span>
            <span className="label text-right">{t(locale, 'col.amount')}</span>
          </div>

          {rows.length === 0 ? (
            <p className="px-4 py-6 text-[13px] text-[var(--color-muted)]">{t(locale, 'tx.empty')}</p>
          ) : (
            rows.map((row) => <Row key={row.id} row={row} locale={locale} />)
          )}
        </div>
      </div>
    </section>
  );
}

function Row({ row, locale }: { row: TransactionRow; locale: Locale }) {
  // One payer paying once needs no spine — the line already says everything.
  const spine = row.entries.length > 1 || row.entries.some((e) => e.installmentCount > 1);
  const shade = spine ? 'bg-[var(--color-well)]' : '';

  return (
    <>
      <div
        className={`${COLS} items-center px-4 py-2 text-[12.5px] ${shade} ${
          spine ? '' : 'border-b border-[var(--color-line)]'
        }`}
      >
        <span className="code text-[11px] text-[var(--color-muted)]">{dayMonth(row.occurredOn)}</span>
        <span className="truncate font-semibold">{row.description ?? '—'}</span>
        <span className="truncate">
          {row.category?.name ?? (
            <span className="text-[var(--color-faint)]">{t(locale, 'cat.uncategorized')}</span>
          )}
        </span>
        <span className="truncate text-[var(--color-ink-2)]">{payer(row, locale)}</span>
        <span className="flex flex-wrap gap-1">{tags(row, locale)}</span>
        <Money
          value={row.totalAmount}
          locale={locale}
          className={`figure text-right font-semibold ${
            row.kind === 'INCOME' ? 'text-[var(--color-positive)]' : ''
          }`}
        />
      </div>

      {spine
        ? row.entries.map((entry, i) => (
            <div
              key={entry.id}
              className={`${COLS} items-center bg-[var(--color-well)] px-4 py-1.5 text-[12px] ${
                i === row.entries.length - 1 ? 'border-b border-[var(--color-line)]' : ''
              }`}
            >
              <span />
              <span className="flex min-w-0 items-center gap-2.5 text-[var(--color-ink-2)]">
                <span className="ml-1 h-3.5 w-px shrink-0 bg-[var(--color-rule)]" aria-hidden />
                <span className="truncate">{source(entry, locale)}</span>
              </span>
              <span />
              <span className="truncate text-[11.5px] text-[var(--color-muted)]">
                {entry.installmentCount > 1 && entry.settlements[0] ? (
                  <>
                    {entry.installmentCount}× <Money value={entry.settlements[0].amount} locale={locale} />
                  </>
                ) : null}
              </span>
              <span className="code truncate text-[10.5px] text-[var(--color-muted)]">
                {settlesOn(entry.settlements)}
              </span>
              <Money
                value={entry.amount}
                locale={locale}
                className="figure text-right text-[var(--color-ink-2)]"
              />
            </div>
          ))
        : null}
    </>
  );
}

function payer(row: TransactionRow, locale: Locale): string {
  const [first] = row.entries;
  if (row.entries.length === 1 && first) return source(first, locale);
  const key = row.entries.every((e) => e.card) ? 'tx.cards' : 'tx.sources';
  return `${row.entries.length} ${t(locale, key)}`;
}

function source(entry: Entry, locale: Locale): string {
  const name = entry.card?.name ?? entry.account?.name ?? '—';
  if (!entry.cardFunction) return name;
  return `${name} · ${t(locale, entry.cardFunction === 'CREDIT' ? 'acc.credit' : 'acc.debit')}`;
}

function tags(row: TransactionRow, locale: Locale) {
  const out = [];
  if (row.kind !== 'EXPENSE') out.push(<Chip key="kind">{t(locale, `kind.${row.kind}`)}</Chip>);
  if (row.entries.length > 1) out.push(<Chip key="split">{t(locale, 'tx.split')}</Chip>);
  if (row.occurrenceType === 'RECURRING') out.push(<Chip key="rec">{t(locale, 'tx.recurring')}</Chip>);
  const max = Math.max(...row.entries.map((e) => e.installmentCount), 1);
  if (max > 1) out.push(<Chip key="inst">{max}×</Chip>);
  return out;
}

/** The purchase date — what the category report accrues on, not the payment. */
function dayMonth(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/**
 * Where the money actually leaves: one date when it settles at once, the list
 * of months when it is spread across invoices (BR10).
 */
function settlesOn(settlements: Entry['settlements']): string {
  if (settlements.length === 0) return '—';
  const [only] = settlements;
  if (settlements.length === 1 && only) return `${only.dueOn.slice(8, 10)}/${only.dueOn.slice(5, 7)}`;
  return settlements.map((s) => `${s.dueOn.slice(5, 7)}/${s.dueOn.slice(2, 4)}`).join(' · ');
}
