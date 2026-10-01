import type { ReactNode } from 'react';

/**
 * BR34/BR35 — opening + income − expenses = closing.
 *
 * The carry is its own step with its own label, never folded into income:
 * counting it as income would inflate every average and budget comparison.
 *
 * The operators ride in the step labels rather than in their own cells, so the
 * strip reads as one sentence instead of six boxes.
 */
export function Flow({ children }: { children: ReactNode }) {
  return <div className="tile flex flex-wrap items-stretch overflow-hidden">{children}</div>;
}

export function FlowStep({
  label,
  tag,
  value,
  note,
  variant,
}: {
  label: string;
  tag?: string;
  value: ReactNode;
  note?: ReactNode;
  variant?: 'carried' | 'in' | 'out' | 'result';
}) {
  const surface = variant === 'result' ? 'bg-[var(--color-accent-well)]' : '';
  const figure =
    variant === 'in'
      ? 'text-[var(--color-positive)]'
      : variant === 'out'
        ? 'text-[var(--color-bad)]'
        : variant === 'carried'
          ? 'text-[var(--color-ink-2)]'
          : '';

  return (
    <div className={`min-w-0 flex-1 basis-40 px-4 py-3.5 ${surface}`}>
      <div className="label mb-1.5 flex items-center gap-1.5">
        <span className="truncate">{label}</span>
        {tag ? <span className="font-normal text-[var(--color-faint)]">· {tag}</span> : null}
      </div>
      <div className={`figure text-[19px] font-semibold ${figure}`}>{value}</div>
      {note ? <div className="mt-0.5 text-[11px] text-[var(--color-muted)]">{note}</div> : null}
    </div>
  );
}

/** A hairline between steps, broken in the middle to carry the operator. */
export const FlowOp = ({ children }: { children: string }) => (
  <div className="flex w-6 flex-col items-center py-3">
    <span className="w-px flex-1 bg-[var(--color-line)]" aria-hidden />
    <span className="py-1 text-[13px] text-[var(--color-faint)]">{children}</span>
    <span className="w-px flex-1 bg-[var(--color-line)]" aria-hidden />
  </div>
);
