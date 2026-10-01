'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/** Restores a full JSON backup. Replacing existing data needs an explicit tick. */
export function RestoreBackup() {
  const router = useRouter();
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (replace && !confirm('Apagar todos os seus dados atuais e substituir pelo backup?')) return;

    setBusy(true);
    setResult(null);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/data/restore?replace=${replace}`, { method: 'POST', body: fd });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { detail?: { message?: string } };
    if (res.ok) {
      setResult(body as Record<string, number>);
      router.refresh();
    } else {
      setError(body.detail?.message ?? String(body.code ?? 'falhou'));
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <a
        href="/api/data/backup"
        className="flex items-center justify-between rounded-[10px] border border-[var(--color-line)] px-3.5 py-3 text-[13px] transition hover:bg-[var(--color-well)]"
      >
        <span>
          <strong>Baixar backup</strong>
          <span className="ml-2 text-[var(--color-muted)]">tudo: contas, cartões, categorias, transações, faturas, metas</span>
        </span>
        <span className="font-semibold text-[var(--color-accent)]">↓ JSON</span>
      </a>

      <div className="rounded-[10px] border border-dashed border-[var(--color-rule)] p-3.5">
        <div className="mb-1.5 text-[12px] font-semibold text-[var(--color-ink-2)]">Restaurar backup (.json)</div>
        <input
          type="file"
          accept=".json,application/json"
          onChange={onFile}
          disabled={busy}
          className="block w-full text-[12px] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-[var(--color-on-accent)]"
        />
        <label className="mt-2 flex items-center gap-2 text-[12px] text-[var(--color-ink-2)]">
          <input
            type="checkbox"
            checked={replace}
            onChange={(e) => setReplace(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Substituir meus dados atuais (apaga tudo antes de restaurar)
        </label>
      </div>

      {busy ? <p className="text-[12px] text-[var(--color-muted)]">Restaurando…</p> : null}
      {error ? (
        <p className="rounded-md bg-[var(--color-bad)]/8 px-3 py-2 text-[12px] font-medium text-[var(--color-bad)]">{error}</p>
      ) : null}
      {result ? (
        <div className="rounded-[10px] border border-[var(--color-good)]/30 bg-[var(--color-good)]/8 px-3.5 py-2.5 text-[13px]">
          Restaurado: <strong>{result.accounts}</strong> contas · <strong>{result.cards}</strong> cartões ·{' '}
          <strong>{result.categories}</strong> categorias · <strong>{result.transactions}</strong> transações ·{' '}
          <strong>{result.goals}</strong> metas.
        </div>
      ) : null}
    </div>
  );
}
