'use client';

import { useState } from 'react';

import { add, money, sub, type Money as MoneyString } from '@cc/domain/money';

import { MoneyInput } from '@/components/ui/money-input';
import { displayMoney, toApiMoney } from '@/lib/money-input';

import { Money } from '@/components/ui/money';

interface Account {
  id: string;
  name: string;
  balance: string;
}

/**
 * Pay an invoice — a client component because the remainder must react
 * per keystroke, exactly like the split editor.
 *
 * BR31: the sources are accounts, never a card — debt cannot pay debt, so no
 * card appears in the picker at all. Paying more than is open is blocked here
 * and rejected again by the API.
 */
export function PayInvoice({
  invoiceId,
  open,
  accounts,
  onPaid,
}: {
  invoiceId: string;
  open: string;
  accounts: Account[];
  onPaid: () => void;
}) {
  const [parts, setParts] = useState([{ accountId: accounts[0]?.id ?? '', amount: displayMoney(open) }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allocated = parts.reduce<MoneyString>((sum, p) => add(sum, safe(p.amount)), money('0'));
  const remainder = sub(money(open), allocated);
  const overpaying = Number(allocated) > Number(open);
  const balanced = Number(allocated) > 0 && !overpaying;

  const update = (i: number, patch: Partial<(typeof parts)[number]>) =>
    setParts((c) => c.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/invoices/${invoiceId}/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paidOn: new Date().toISOString().slice(0, 10),
        sources: parts.map((p) => ({ accountId: p.accountId, amount: safe(p.amount) })),
      }),
    });
    if (response.ok) {
      onPaid();
    } else {
      const body = (await response.json().catch(() => ({}))) as { code?: string };
      setError(body.code === 'OVERPAYMENT' ? 'Valor maior que o aberto' : 'Falha ao pagar');
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2.5 rounded-lg bg-[var(--color-inset)] p-3">
      {parts.map((part, i) => (
        <div key={i} className="grid grid-cols-[1fr_7rem_2rem] items-center gap-2">
          <select
            value={part.accountId}
            onChange={(e) => update(i, { accountId: e.target.value })}
            className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[13px]"
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.balance}
              </option>
            ))}
          </select>
          <MoneyInput
            value={part.amount}
            onChange={(next) => update(i, { amount: next })}
            className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-1.5 text-right text-[13px] tabular"
          />
          <button
            type="button"
            onClick={() => setParts((c) => c.filter((_, idx) => idx !== i))}
            disabled={parts.length === 1}
            className="grid h-8 place-items-center rounded-md bg-[var(--color-well)] text-[var(--color-muted)] disabled:opacity-40"
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() =>
          setParts((c) => [...c, { accountId: accounts[0]?.id ?? '', amount: '0.00' }])
        }
        className="self-start text-[11px] font-semibold text-[var(--color-series-1)]"
      >
        + dividir entre contas
      </button>

      <div
        className={`flex items-center justify-between rounded-md px-2.5 py-1.5 text-[12px] tabular ${
          overpaying
            ? 'bg-[var(--color-bad)]/10 text-[var(--color-bad)]'
            : balanced
              ? 'bg-[var(--color-good)]/10 text-[var(--color-positive)]'
              : 'bg-[var(--color-well)] text-[var(--color-muted)]'
        }`}
      >
        <span>
          pagando <Money value={allocated} locale="pt-BR" /> de <Money value={open} locale="pt-BR" />
        </span>
        <span className="font-semibold">
          {overpaying
            ? 'acima do aberto'
            : Number(remainder) > 0
              ? `resta ${remainder}`
              : '✓'}
        </span>
      </div>

      {error ? <p className="text-[12px] font-semibold text-[var(--color-bad)]">{error}</p> : null}

      <button
        type="button"
        onClick={submit}
        disabled={!balanced || busy}
        className="btn-accent self-end px-3.5 py-2 text-[13px] disabled:opacity-40"
      >
        {busy ? '…' : 'Pagar fatura'}
      </button>
    </div>
  );
}

/** The field holds a pt-BR spelling; the domain only parses `1234.56`. */
function safe(raw: string): MoneyString {
  try {
    const api = toApiMoney(raw);
    return money(api === '' ? '0' : api);
  } catch {
    return money('0');
  }
}
