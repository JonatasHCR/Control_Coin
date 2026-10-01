import { Money } from '@/components/ui/money';
import type { Locale } from '@/lib/i18n';

/**
 * Single-series magnitude: no legend — the title names the series (ARCH06).
 * Uncategorized is drawn in the neutral rule colour so it reads as "not a
 * category" rather than as another one.
 */
export function BarList({
  rows,
  locale,
}: {
  rows: { label: string; value: string; essential: boolean | null; muted?: boolean }[];
  locale: Locale;
}) {
  const max = rows.reduce((m, r) => Math.max(m, Number(r.value)), 0) || 1;

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[7rem_1fr_6.5rem] items-center gap-3">
          <span
            className={`truncate text-[13px] ${row.muted ? 'italic text-[var(--color-muted)]' : 'text-[var(--color-ink-2)]'}`}
          >
            {row.label}
            {row.essential ? (
              <span className="ml-1.5 rounded-[5px] bg-[var(--color-series-2)]/15 px-1.5 py-px text-[9.5px] font-bold tracking-[0.04em] text-[var(--color-series-2)]">
                ESS
              </span>
            ) : null}
          </span>
          <span className="block h-1.5 overflow-hidden rounded-full bg-[var(--color-well)]">
            <span
              className="block h-full rounded-full"
              style={{
                width: `${Math.max((Number(row.value) / max) * 100, 2)}%`,
                background: row.muted
                  ? 'var(--color-rule)'
                  : row.essential
                    ? 'var(--color-series-2)'
                    : 'var(--color-series-1)',
              }}
            />
          </span>
          <Money value={row.value} locale={locale} className="figure text-right text-[13px] font-semibold" />
        </div>
      ))}
    </div>
  );
}
