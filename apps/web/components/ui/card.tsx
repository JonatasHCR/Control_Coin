import type { ReactNode } from 'react';

export function Card({
  children,
  className = '',
  id,
}: {
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section id={id} className={`tile p-4 ${className}`}>
      {children}
    </section>
  );
}

export function CardHead({
  title,
  note,
  action,
}: {
  title: string;
  note?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <header className="mb-3.5 flex items-baseline justify-between gap-3">
      <h2 className="font-[family-name:var(--font-display)] text-[14px] font-semibold">{title}</h2>
      {action ?? (note ? <span className="text-[11.5px] text-[var(--color-muted)]">{note}</span> : null)}
    </header>
  );
}

/** The rule this card obeys, stated where the card is read. */
export function Callout({ children }: { children: ReactNode }) {
  return <p className="note mt-3.5">{children}</p>;
}

/** A stat tile: label, figure, and one line of context underneath. */
export function Stat({
  label,
  children,
  meta,
  tone,
}: {
  label: string;
  children: ReactNode;
  meta?: ReactNode;
  tone?: 'positive' | 'negative' | 'muted';
}) {
  const colour =
    tone === 'positive'
      ? 'text-[var(--color-positive)]'
      : tone === 'negative'
        ? 'text-[var(--color-series-2)]'
        : tone === 'muted'
          ? 'text-[var(--color-ink-2)]'
          : '';

  return (
    <div className="tile p-4">
      <div className="label mb-1.5">{label}</div>
      <div className={`figure text-[21px] font-semibold ${colour}`}>{children}</div>
      {meta ? <div className="mt-1 text-[11px] text-[var(--color-muted)]">{meta}</div> : null}
    </div>
  );
}

export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'essential' | 'good' | 'bad' | 'ghost';
}) {
  const styles = {
    neutral: 'bg-[var(--color-inset)] text-[var(--color-ink-2)]',
    // Matches the essential bar in BarList — chip and bar must agree (BR17).
    essential: 'bg-[var(--color-series-2)]/12 text-[var(--color-series-2)]',
    good: 'bg-[var(--color-accent-soft)] text-[var(--color-positive)]',
    bad: 'bg-[var(--color-bad)]/12 text-[var(--color-bad)]',
    ghost: 'border border-dashed border-[var(--color-rule)] text-[var(--color-faint)]',
  }[tone];

  return <span className={`chip ${styles}`}>{children}</span>;
}
