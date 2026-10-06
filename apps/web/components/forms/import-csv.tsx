'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

/**
 * CSV import. The user picks the target account and confirms the column
 * mapping, then imports. Rows land Uncategorized and duplicates are skipped
 * — the result states exactly what happened.
 */
export function ImportCsv({ accounts }: { accounts: { id: string; name: string }[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [csv, setCsv] = useState('');
  const [cols, setCols] = useState({ date: 0, description: 1, amount: 2, category: -1 });
  const [result, setResult] = useState<{ imported: number; duplicates: number; errors: number; categoriesCreated?: string[] } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [asPlanned, setAsPlanned] = useState(false);
  const [notify, setNotify] = useState('3');
  const [resultKind, setResultKind] = useState<'transactions' | 'planned'>('transactions');

  const preview = csv
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith('#'))
    .slice(0, 4);
  const columnCount = preview[0]?.split(',').length ?? 0;

  async function run(): Promise<void> {
    setBusy(true);
    setResult(null);
    const res = await fetch('/api/data/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accountId,
        csv,
        columns: { date: cols.date, description: cols.description, amount: cols.amount, ...(cols.category >= 0 ? { category: cols.category } : {}) },
        as: asPlanned ? 'planned' : 'transactions',
        notifyDaysBefore: Math.min(60, Math.max(0, Number(notify) || 0)),
      }),
    });
    if (res.ok) {
      setResultKind(asPlanned ? 'planned' : 'transactions');
      setResult(await res.json());
      router.refresh();
    }
    setBusy(false);
  }

  async function onXlsx(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setResult(null);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`/api/data/import-xlsx?accountId=${accountId}`, {
      method: 'POST',
      body: fd,
    });
    if (res.ok) {
      setResultKind('transactions');
      setResult(await res.json());
      router.refresh();
    }
    setBusy(false);
    e.target.value = '';
  }

  return (
    <div className="flex flex-col gap-3.5">
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">Importar para</span>
        <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={input}>
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-[var(--color-muted)]">
          Um extrato nunca diz a que conta pertence — você diz.
        </span>
      </label>


      <div className="rounded-[10px] border border-dashed border-[var(--color-rule)] p-3.5">
        <div className="mb-1.5 text-[12px] font-semibold text-[var(--color-ink-2)]">Ou envie um Excel (.xlsx)</div>
        <input
          type="file"
          accept=".xlsx"
          onChange={onXlsx}
          className="block w-full text-[12px] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-[var(--color-on-accent)]"
        />
        <p className="mt-1.5 text-[11px] text-[var(--color-muted)]">
          Cabeçalho detectado onde estiver, fórmula lida pelo valor em cache, centavos preservados.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">Importar o CSV como</span>
        <div className="grid grid-cols-2 gap-1 rounded-[10px] bg-[var(--color-well)] p-1">
          {([false, true] as const).map((planned) => (
            <button
              key={String(planned)}
              type="button"
              onClick={() => setAsPlanned(planned)}
              className={`rounded-md py-1.5 text-[12px] font-semibold ${
                asPlanned === planned ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-muted)]'
              }`}
            >
              {planned ? 'Previstos' : 'Lançamentos'}
            </button>
          ))}
        </div>
        {asPlanned ? (
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <span>A data vira a data prevista; negativo = despesa, positivo = receita. Não mexe em saldo até você confirmar.</span>
            <label className="flex items-center gap-1.5">
              Avisar
              <input
                type="number"
                min={0}
                max={60}
                value={notify}
                onChange={(e) => setNotify(e.target.value)}
                className="w-14 rounded border border-[var(--color-rule)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[12px] text-[var(--color-ink)]"
              />
              dias antes
            </label>
          </div>
        ) : null}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">Cole o CSV</span>
        <textarea
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
          rows={5}
          placeholder={'data,descricao,valor,categoria\n2026-07-02,Padaria,-45.00,Alimentação\n2026-07-03,Pix recebido,120.00,'}
          className={`${input} font-mono text-[12px]`}
        />
      </label>

      {preview.length > 0 && columnCount > 0 ? (
        <div className="rounded-[10px] border border-[var(--color-line)] bg-[var(--color-well)] p-3">
          <div className="mb-2 grid grid-cols-2 gap-2 text-[11px] font-semibold text-[var(--color-muted)] sm:grid-cols-4">
            {(['date', 'description', 'amount', 'category'] as const).map((field) => (
              <label key={field} className="flex flex-col gap-1">
                <span className="uppercase tracking-wide">{field === 'date' && asPlanned ? 'data prevista' : COLUMN_LABEL[field]}</span>
                <select
                  value={cols[field]}
                  onChange={(e) => setCols({ ...cols, [field]: Number(e.target.value) })}
                  className="rounded border border-[var(--color-rule)] bg-[var(--color-surface)] px-1.5 py-1"
                >
                  {field === 'category' ? <option value={-1}>— nenhuma</option> : null}
                  {Array.from({ length: columnCount }).map((_, i) => (
                    <option key={i} value={i}>
                      coluna {i + 1}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {preview.map((line, i) => (
            <div
              key={i}
              className="border-t border-[var(--color-line)] py-1 font-mono text-[11px] text-[var(--color-ink-2)]"
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}

      {result ? (
        <div className="rounded-[10px] border border-[var(--color-good)]/30 bg-[var(--color-good)]/8 px-3.5 py-2.5 text-[13px]">
          <strong>{result.imported}</strong> {resultKind === 'planned' ? 'previstos criados' : 'importadas'} · <strong>{result.duplicates}</strong> duplicadas
          (ignoradas) · <strong>{result.errors}</strong> com erro.
          {result.categoriesCreated && result.categoriesCreated.length > 0
            ? ` Categorias novas criadas: ${result.categoriesCreated.join(', ')}.`
            : cols.category < 0
              ? ' Sem coluna de categoria, ficam Sem categoria até você classificar.'
              : ''}
        </div>
      ) : null}

      <button
        type="button"
        onClick={run}
        disabled={busy || csv.trim() === ''}
        className="btn-accent self-end px-4 py-2.5 text-[13px] disabled:opacity-40"
      >
        {busy ? '…' : asPlanned ? 'Importar previstos' : 'Importar'}
      </button>
    </div>
  );
}

const COLUMN_LABEL = { date: 'data', description: 'descrição', amount: 'valor', category: 'categoria (opcional)' } as const;

const input =
  'w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]';
