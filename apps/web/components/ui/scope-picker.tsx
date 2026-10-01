'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

export interface ScopeOption {
  id: string;
  name: string;
}

/**
 * BR16 — a report is scoped to one wallet, several, or all of them. Several is
 * a real answer, not a convenience: a household keeps its wallets apart and
 * still wants them read together, so the control is a set of toggles with an
 * explicit "general" rather than a single-choice dropdown.
 *
 * The chosen scope lives in the URL (ARCH06), so a scoped view is linkable and
 * the back button works.
 */
export function ScopePicker({
  wallets,
  scope,
  label,
  generalLabel,
  basePath = '/',
}: {
  wallets: ScopeOption[];
  scope: string;
  label: string;
  generalLabel: string;
  basePath?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [open, setOpen] = useState(false);

  const chosen = scope === 'all' || scope === '' ? [] : scope.split(',').filter(Boolean);
  const isGeneral = chosen.length === 0;

  const go = (next: string[]): void => {
    const query = new URLSearchParams(params.toString());
    if (next.length === 0) query.delete('scope');
    else query.set('scope', next.join(','));
    router.push(`${basePath}?${query.toString()}`);
  };

  const toggle = (id: string): void =>
    go(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  const summary = isGeneral
    ? generalLabel
    : chosen
        .map((id) => wallets.find((w) => w.id === id)?.name ?? id)
        .join(' + ');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        className="tile flex items-center gap-2 rounded-full px-3.5 py-2 text-[12.5px] transition hover:border-[var(--color-rule)]"
      >
        <span className="label">{label}</span>
        <span className="max-w-[220px] truncate font-semibold">{summary}</span>
        <span className="text-[9px] text-[var(--color-muted)]">▼</span>
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="fechar"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div
            className="tile absolute right-0 z-50 mt-1 w-[260px] p-1.5"
            style={{ boxShadow: 'var(--shadow-pop)' }}
          >
            <button
              type="button"
              onClick={() => {
                go([]);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[13px] transition hover:bg-[var(--color-well)] ${
                isGeneral ? 'font-semibold text-[var(--color-accent)]' : ''
              }`}
            >
              <span className="w-4">{isGeneral ? '●' : '○'}</span>
              {generalLabel}
            </button>

            <div className="my-1 h-px bg-[var(--color-line)]" />

            {wallets.map((w) => (
              <label
                key={w.id}
                className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-2 text-[13px] transition hover:bg-[var(--color-well)]"
              >
                <input
                  type="checkbox"
                  checked={chosen.includes(w.id)}
                  onChange={() => toggle(w.id)}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                {w.name}
              </label>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
