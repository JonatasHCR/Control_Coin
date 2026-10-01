import { Money } from '@/components/ui/money';

/**
 * A budget or goal meter. The state colour is paired with the number, never
 * carried by colour alone.
 */
export function Meter({
  label,
  consumed,
  limit,
  percent,
  state,
  note,
}: {
  label: React.ReactNode;
  consumed: string;
  limit: string | null;
  percent: number | null;
  state: 'ok' | 'warn' | 'over' | 'goal';
  note?: string;
}) {
  // A meter is one series, so it takes the accent. The validated chart pair is
  // reserved for the category bars, where essential and non-essential must
  // stay distinguishable (BR17/BR18).
  const fill =
    state === 'over'
      ? 'var(--color-bad)'
      : state === 'warn'
        ? 'var(--color-warn)'
        : 'var(--color-accent)';
  const width = Math.min(percent ?? 0, 100);

  return (
    <div className="border-b border-[var(--color-line)] py-3 last:border-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-3 text-[13px]">
        <span className="flex items-center gap-2">{label}</span>
        <span className="tabular text-[12px] text-[var(--color-muted)]">
          <Money value={consumed} locale="pt-BR" />
          {limit ? (
            <>
              {' / '}
              <Money value={limit} locale="pt-BR" />
            </>
          ) : null}
          {percent !== null ? <span className="ml-1.5 font-semibold">{percent}%</span> : null}
        </span>
      </div>
      <span className="block h-2 overflow-hidden rounded-full bg-[var(--color-well)]">
        <span className="block h-full rounded-full" style={{ width: `${width}%`, background: fill }} />
      </span>
      {note ? <p className="mt-1 text-[11px] text-[var(--color-muted)]">{note}</p> : null}
    </div>
  );
}
