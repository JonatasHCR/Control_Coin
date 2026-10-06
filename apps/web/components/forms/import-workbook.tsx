'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Result = {
  created: { wallets: number; accounts: number; cards: number; categories: number; transactions: number; planned: number };
  skipped: number;
  errors: string[];
};

const PARTS = [
  { key: 'entries', label: 'Lançamentos', hint: 'o que já aconteceu' },
  { key: 'planned', label: 'Previstos', hint: 'o que pode acontecer' },
  { key: 'categories', label: 'Categorias', hint: 'criar categorias novas' },
  { key: 'accounts', label: 'Contas', hint: 'criar contas novas' },
  { key: 'cards', label: 'Cartões', hint: 'criar cartões novos' },
  { key: 'wallets', label: 'Carteiras', hint: 'criar carteiras novas' },
] as const;

/** The fill-in workbook: pick the parts, download them pre-filled, send back. */
export function ImportWorkbook() {
  const router = useRouter();
  const [parts, setParts] = useState<string[]>(['entries']);
  const toggle = (key: string) => setParts((p) => (p.includes(key) ? p.filter((x) => x !== key) : [...p, key]));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<{ message: string; rows: string[] } | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    setResult(null);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/data/import-workbook', { method: 'POST', body: fd });
    const body = (await res.json().catch(() => ({}))) as Result & { code?: string; detail?: { message?: string; errors?: string[] } };
    if (res.ok) {
      setResult(body);
      router.refresh();
    } else {
      setError({ message: body.detail?.message ?? body.code ?? 'falhou', rows: body.detail?.errors ?? [] });
    }
    setBusy(false);
  }

  const c = result?.created;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="mb-1.5 text-[12px] font-semibold text-[var(--color-ink-2)]">1. O que você quer importar?</div>
        <div className="grid grid-cols-2 gap-1.5">
          {PARTS.map((p) => (
            <label
              key={p.key}
              className={`flex cursor-pointer items-start gap-2 rounded-[10px] border px-3 py-2 text-[13px] transition ${
                parts.includes(p.key) ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)]' : 'border-[var(--color-line)] hover:bg-[var(--color-well)]'
              }`}
            >
              <input type="checkbox" checked={parts.includes(p.key)} onChange={() => toggle(p.key)} className="mt-0.5 accent-[var(--color-accent)]" />
              <span>
                <strong>{p.label}</strong>
                <span className="block text-[11px] text-[var(--color-muted)]">{p.hint}</span>
              </span>
            </label>
          ))}
        </div>
        <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
          A planilha vem só com essas abas. Suas contas, cartões e categorias já aparecem nas listas para escolher.
        </p>
      </div>

      <a
        href={parts.length > 0 ? `/api/data/template?parts=${parts.join(',')}` : undefined}
        aria-disabled={parts.length === 0}
        className={`flex items-center justify-between rounded-[10px] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3.5 py-3 text-[13px] transition hover:brightness-105 ${
          parts.length === 0 ? 'pointer-events-none opacity-40' : ''
        }`}
      >
        <span>
          <strong>2. Baixar planilha</strong>
          <span className="ml-2 text-[var(--color-ink-2)]">e preencher</span>
        </span>
        <span className="font-semibold text-[var(--color-accent)]">↓ XLSX</span>
      </a>

      <div className="rounded-[10px] border border-dashed border-[var(--color-rule)] p-3.5">
        <div className="mb-1.5 text-[12px] font-semibold text-[var(--color-ink-2)]">3. Enviar planilha preenchida</div>
        <input
          type="file"
          accept=".xlsx"
          onChange={onFile}
          disabled={busy}
          className="block w-full text-[12px] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-[var(--color-on-accent)]"
        />
      </div>

      {busy ? <p className="text-[12px] text-[var(--color-muted)]">Importando…</p> : null}

      {error ? (
        <div className="rounded-md bg-[var(--color-bad)]/8 px-3 py-2 text-[12px] text-[var(--color-bad)]">
          <p className="font-semibold">{error.message}</p>
          {error.rows.length > 0 ? (
            <ul className="mt-1.5 ml-4 list-disc">
              {error.rows.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {c ? (
        <div className="rounded-[10px] border border-[var(--color-good)]/30 bg-[var(--color-good)]/8 px-3.5 py-2.5 text-[13px]">
          Importado: <strong>{c.transactions}</strong> lançamentos · <strong>{c.planned}</strong> previstos
          {c.accounts + c.cards + c.categories + c.wallets > 0 ? (
            <>
              {' '}· novos: {c.wallets} carteiras, {c.accounts} contas, {c.cards} cartões, {c.categories} categorias
            </>
          ) : null}
          {result!.skipped > 0 ? <> · {result!.skipped} já importados antes (ignorados)</> : null}
          {result!.errors.length > 0 ? (
            <ul className="mt-1.5 ml-4 list-disc text-[12px] text-[var(--color-bad)]">
              {result!.errors.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
