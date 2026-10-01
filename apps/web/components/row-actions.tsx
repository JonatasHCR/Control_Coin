'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { ArchiveIcon, TrashIcon } from '@/components/ui/icons';

const iconBtn =
  'inline-grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition hover:bg-[var(--color-well)] disabled:opacity-40';

/**
 * A delete icon-button for a list row. Confirms, calls the authenticated proxy
 * (which forwards to the Nest API), and refreshes the server component. The API
 * enforces every rule — archive-vs-delete, reassign, cascade — so this only
 * asks and reports the reason it gives back.
 */
export function DeleteButton({
  path,
  confirmLabel,
  title = 'Excluir',
}: {
  path: string; // e.g. `transactions/<id>` or `budgets/<id>?...`
  confirmLabel: string;
  title?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    if (!window.confirm(confirmLabel)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/${path}`, { method: 'DELETE' });
    if (res.ok) {
      router.refresh();
    } else {
      const body = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(typeof body.detail === 'string' ? body.detail : 'não foi possível excluir');
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-[11px] text-[var(--color-bad)]">{error}</span> : null}
      <button
        type="button"
        onClick={run}
        disabled={busy}
        title={title}
        aria-label={title}
        className={`${iconBtn} hover:text-[var(--color-bad)]`}
      >
        <TrashIcon />
      </button>
    </span>
  );
}

/** Archive icon-button — for accounts and cards that have history. */
export function ArchiveButton({ id, kind }: { id: string; kind: 'WALLET' | 'ACCOUNT' | 'CARD' }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(): Promise<void> {
    setBusy(true);
    await fetch(`/api/accounts/${id}/archive?kind=${kind}`, { method: 'POST' });
    router.refresh();
    setBusy(false);
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      title="Arquivar"
      aria-label="Arquivar"
      className={`${iconBtn} hover:text-[var(--color-ink)]`}
    >
      <ArchiveIcon />
    </button>
  );
}
