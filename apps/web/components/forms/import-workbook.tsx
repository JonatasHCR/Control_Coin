'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Result = {
  created: { wallets: number; accounts: number; cards: number; categories: number; transactions: number };
  skipped: number;
  errors: string[];
};

/** The fill-in workbook: download it pre-filled, send it back filled. */
export function ImportWorkbook() {
  const router = useRouter();
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
      <ol className="ml-4 list-decimal text-[13px] text-[var(--color-ink-2)] [&>li]:mt-1">
        <li>Baixe a planilha. Ela já vem com suas contas, cartões e categorias.</li>
        <li>Preencha a aba <strong>Lançamentos</strong> (e as outras, se quiser criar algo novo). As colunas têm listas para escolher.</li>
        <li>Envie de volta. Saldos, faturas, parcelas e médias são calculados pelo sistema.</li>
      </ol>

      <a
        href="/api/data/template"
        className="flex items-center justify-between rounded-[10px] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3.5 py-3 text-[13px] transition hover:brightness-105"
      >
        <span>
          <strong>Baixar planilha para preencher</strong>
        </span>
        <span className="font-semibold text-[var(--color-accent)]">↓ XLSX</span>
      </a>

      <div className="rounded-[10px] border border-dashed border-[var(--color-rule)] p-3.5">
        <div className="mb-1.5 text-[12px] font-semibold text-[var(--color-ink-2)]">Enviar planilha preenchida</div>
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
          Importado: <strong>{c.transactions}</strong> lançamentos
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
