'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { Source } from '@/components/forms/transaction-form';
import { EditIcon, TrashIcon } from '@/components/ui/icons';
import { MoneyInput } from '@/components/ui/money-input';
import { displayMoney, toApiMoney } from '@/lib/money-input';

type Kind = 'EXPENSE' | 'INCOME' | 'TRANSFER';
type Fn = 'CREDIT' | 'DEBIT';

export interface Planned {
  id: string;
  kind: Kind;
  description: string;
  amount: string;
  expectedOn: string;
  categoryId: string | null;
  categoryName: string | null;
  accountId: string | null;
  cardId: string | null;
  cardFunction: Fn | null;
  sourceName: string | null;
  destinationAccountId: string | null;
  destinationName: string | null;
  notifyDaysBefore: number;
  status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
  resolvedAt: string | null;
}

const KIND_LABEL: Record<Kind, string> = { EXPENSE: 'Despesa', INCOME: 'Receita', TRANSFER: 'Transferência' };
const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time
const brl = (v: string) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brDate = (iso: string) => iso.split('-').reverse().join('/');

function daysUntil(iso: string): number {
  return Math.round((Date.parse(`${iso}T00:00:00`) - Date.parse(`${today()}T00:00:00`)) / 86_400_000);
}

/** UC13: plans that may happen, and the confirmation of what did (BR40). */
export function PlannedBoard({
  pending,
  resolved,
  sources,
  categories,
}: {
  pending: Planned[];
  resolved: Planned[];
  sources: Source[];
  categories: { id: string; name: string }[];
}) {
  const [editing, setEditing] = useState<Planned | 'new' | null>(null);
  const [confirming, setConfirming] = useState<Planned | null>(null);
  const [missed, setMissed] = useState<Planned | null>(null);

  // Arriving from a notification (/planned#<id>) opens that plan's confirmation.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    const hit = pending.find((p) => p.id === id);
    if (hit) setConfirming(hit);
  }, [pending]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button type="button" onClick={() => setEditing('new')} className="btn-accent px-4 py-2 text-[13px]">
          + Novo previsto
        </button>
      </div>

      <section className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
        <h2 className="mb-3 text-[14px] font-semibold">A confirmar</h2>
        {pending.length === 0 ? (
          <p className="text-[13px] text-[var(--color-muted)]">
            Nada previsto. Cadastre uma despesa, receita ou transferência que pode acontecer — você será avisado perto da data.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {pending.map((p) => (
              <PendingRow key={p.id} plan={p} onConfirm={() => setConfirming(p)} onMissed={() => setMissed(p)} onEdit={() => setEditing(p)} />
            ))}
          </div>
        )}
      </section>

      {resolved.length > 0 ? (
        <section className="rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-4">
          <h2 className="mb-3 text-[14px] font-semibold">Resolvidos recentemente</h2>
          <div className="flex flex-col gap-1.5 text-[13px]">
            {resolved.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 border-b border-[var(--color-line)] py-1.5 last:border-0">
                <span>
                  <span className="text-[var(--color-muted)]">{KIND_LABEL[p.kind]} · </span>
                  {p.description}
                  <span className="ml-2 text-[12px] text-[var(--color-muted)]">previsto {brDate(p.expectedOn)}</span>
                </span>
                <span className={`text-[12px] font-semibold ${p.status === 'CONFIRMED' ? 'text-[var(--color-good)]' : 'text-[var(--color-muted)]'}`}>
                  {p.status === 'CONFIRMED' ? '✓ aconteceu' : 'não vai acontecer'}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {editing ? (
        <PlanDialog plan={editing === 'new' ? null : editing} sources={sources} categories={categories} onClose={() => setEditing(null)} />
      ) : null}
      {missed ? <MissedDialog plan={missed} onClose={() => setMissed(null)} /> : null}
      {confirming ? (
        <ConfirmDialog plan={confirming} sources={sources} categories={categories} onClose={() => setConfirming(null)} />
      ) : null}
    </div>
  );
}

function PendingRow({ plan, onConfirm, onMissed, onEdit }: { plan: Planned; onConfirm: () => void; onMissed: () => void; onEdit: () => void }) {
  const router = useRouter();
  const days = daysUntil(plan.expectedOn);
  const badge =
    days < 0
      ? { text: `atrasado ${-days} dia(s)`, cls: 'bg-[var(--color-bad)]/10 text-[var(--color-bad)]' }
      : days === 0
        ? { text: 'hoje', cls: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]' }
        : { text: `em ${days} dia(s)`, cls: 'bg-[var(--color-well)] text-[var(--color-ink-2)]' };
  const where =
    plan.kind === 'TRANSFER'
      ? [plan.sourceName, plan.destinationName].filter(Boolean).join(' → ')
      : plan.sourceName;

  async function act(path: string, method: string, ask?: string) {
    if (ask && !window.confirm(ask)) return;
    await fetch(`/api/planned/${plan.id}${path}`, { method });
    router.refresh();
  }

  return (
    <div id={plan.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-[var(--color-well)] px-3.5 py-3">
      <div className="min-w-0">
        <div className="text-[13px]">
          <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${badge.cls}`}>{badge.text}</span>
          <span className="font-semibold">{plan.description}</span>
        </div>
        <div className="mt-0.5 text-[12px] text-[var(--color-muted)]">
          {KIND_LABEL[plan.kind]} · {brDate(plan.expectedOn)}
          {plan.categoryName ? ` · ${plan.categoryName}` : ''}
          {where ? ` · ${where}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-[14px] font-semibold tabular ${plan.kind === 'INCOME' ? 'text-[var(--color-good)]' : ''}`}>{brl(plan.amount)}</span>
        <button type="button" onClick={onConfirm} className="btn-accent px-3 py-1.5 text-[12px]">
          Aconteceu
        </button>
        <button
          type="button"
          onClick={onMissed}
          className="rounded-md border border-[var(--color-rule)] px-3 py-1.5 text-[12px] text-[var(--color-ink-2)] hover:bg-[var(--color-surface)]"
        >
          Não aconteceu
        </button>
        <button type="button" onClick={onEdit} title="Editar" aria-label="Editar" className={iconBtn}>
          <EditIcon />
        </button>
        <button type="button" onClick={() => act('', 'DELETE', 'Excluir este previsto?')} title="Excluir" aria-label="Excluir" className={`${iconBtn} hover:text-[var(--color-bad)]`}>
          <TrashIcon />
        </button>
      </div>
    </div>
  );
}

// ── Dialogs ────────────────────────────────────────────────────────────────

function Dialog({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="max-h-[90vh] w-full max-w-[460px] overflow-y-auto rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.2)]">
        <h2 className="mb-4 text-[16px] font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-[var(--color-muted)]">{hint}</span> : null}
    </label>
  );
}

/** Account-or-card picker; the card's function is asked only when it has both. */
function SourcePicker({
  label,
  sources,
  value,
  fn,
  allowCards,
  optional,
  onChange,
}: {
  label: string;
  sources: Source[];
  value: string;
  fn: Fn | '';
  allowCards: boolean;
  optional?: boolean;
  onChange: (id: string, fn: Fn | '') => void;
}) {
  const list = allowCards ? sources : sources.filter((s) => s.kind === 'ACCOUNT');
  const chosen = list.find((s) => s.id === value);
  return (
    <>
      <Field label={label}>
        <select
          value={value}
          onChange={(e) => {
            const s = list.find((x) => x.id === e.target.value);
            onChange(e.target.value, s?.kind === 'CARD' ? (s.functions.includes('CREDIT') ? 'CREDIT' : 'DEBIT') : '');
          }}
          className={input}
        >
          <option value="">{optional ? '— ainda não sei' : '— escolha'}</option>
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.kind === 'CARD' ? '💳 ' : ''}
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {chosen?.kind === 'CARD' && chosen.functions.length > 1 ? (
        <Field label="Função">
          <select value={fn} onChange={(e) => onChange(value, e.target.value as Fn)} className={input}>
            <option value="CREDIT">Crédito</option>
            <option value="DEBIT">Débito</option>
          </select>
        </Field>
      ) : null}
    </>
  );
}

function useSubmit(onDone: () => void) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send(path: string, method: string, body: unknown) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      onDone();
      router.refresh();
    } else {
      const b = (await res.json().catch(() => ({}))) as { code?: string; detail?: { message?: string; issues?: { message?: string }[] } };
      setError(b.detail?.message ?? b.detail?.issues?.[0]?.message ?? b.code ?? 'falhou');
    }
    setBusy(false);
  }
  return { busy, error, send };
}

function PlanDialog({
  plan,
  sources,
  categories,
  onClose,
}: {
  plan: Planned | null;
  sources: Source[];
  categories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>(plan?.kind ?? 'EXPENSE');
  const [description, setDescription] = useState(plan?.description ?? '');
  const [amount, setAmount] = useState(plan ? displayMoney(plan.amount) : '');
  const [expectedOn, setExpectedOn] = useState(plan?.expectedOn ?? today());
  const [categoryId, setCategoryId] = useState(plan?.categoryId ?? '');
  const [sourceId, setSourceId] = useState(plan?.cardId ?? plan?.accountId ?? '');
  const [fn, setFn] = useState<Fn | ''>(plan?.cardFunction ?? '');
  const [destinationId, setDestinationId] = useState(plan?.destinationAccountId ?? '');
  const [notify, setNotify] = useState(String(plan?.notifyDaysBefore ?? 3));
  const { busy, error, send } = useSubmit(onClose);

  const source = sources.find((s) => s.id === sourceId);
  const isCard = source?.kind === 'CARD' && kind === 'EXPENSE';

  function submit() {
    void send(plan ? `planned/${plan.id}` : 'planned', plan ? 'PATCH' : 'POST', {
      kind,
      description,
      amount: toApiMoney(amount),
      expectedOn,
      categoryId: kind === 'TRANSFER' ? null : categoryId || null,
      accountId: source && !isCard ? source.id : null,
      cardId: isCard ? source!.id : null,
      cardFunction: isCard ? fn || 'CREDIT' : null,
      destinationAccountId: kind === 'TRANSFER' ? destinationId || null : null,
      notifyDaysBefore: Number(notify) || 0,
    });
  }

  return (
    <Dialog title={plan ? 'Editar previsto' : 'Novo previsto'} onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <div className="grid grid-cols-3 gap-1 rounded-[10px] bg-[var(--color-well)] p-1">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`rounded-md py-1.5 text-[12px] font-semibold ${kind === k ? 'bg-[var(--color-surface)] text-[var(--color-ink)] shadow-sm' : 'text-[var(--color-muted)]'}`}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <Field label="Descrição">
          <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: IPVA, 13º salário, reserva" className={input} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Valor previsto">
            <MoneyInput value={amount} onChange={setAmount} className={input} />
          </Field>
          <Field label="Data prevista">
            <input type="date" value={expectedOn} onChange={(e) => setExpectedOn(e.target.value)} className={input} />
          </Field>
        </div>
        {kind !== 'TRANSFER' ? (
          <Field label="Categoria">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input}>
              <option value="">— sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <SourcePicker
          label={kind === 'INCOME' ? 'Conta onde deve cair' : kind === 'TRANSFER' ? 'Conta de origem' : 'Conta ou cartão previsto'}
          sources={sources}
          value={sourceId}
          fn={fn}
          allowCards={kind === 'EXPENSE'}
          optional
          onChange={(id, f) => {
            setSourceId(id);
            setFn(f);
          }}
        />
        {kind === 'TRANSFER' ? (
          <SourcePicker label="Conta de destino" sources={sources} value={destinationId} fn="" allowCards={false} optional onChange={(id) => setDestinationId(id)} />
        ) : null}
        <Field label="Avisar quantos dias antes" hint="O sino pede a confirmação a partir daí, e continua pedindo até você responder.">
          <input type="number" min={0} max={60} value={notify} onChange={(e) => setNotify(e.target.value)} className={input} />
        </Field>
        <Footer busy={busy} error={error} onClose={onClose} onSubmit={submit} label={plan ? 'Salvar' : 'Criar'} />
      </div>
    </Dialog>
  );
}

function ConfirmDialog({
  plan,
  sources,
  categories,
  onClose,
}: {
  plan: Planned;
  sources: Source[];
  categories: { id: string; name: string }[];
  onClose: () => void;
}) {
  const [occurredOn, setOccurredOn] = useState(plan.expectedOn <= today() ? plan.expectedOn : today());
  const [amount, setAmount] = useState(displayMoney(plan.amount));
  const [categoryId, setCategoryId] = useState(plan.categoryId ?? '');
  const [sourceId, setSourceId] = useState(plan.cardId ?? plan.accountId ?? '');
  const [fn, setFn] = useState<Fn | ''>(plan.cardFunction ?? '');
  const [installments, setInstallments] = useState('1');
  const [destinationId, setDestinationId] = useState(plan.destinationAccountId ?? '');
  const { busy, error, send } = useSubmit(() => {
    window.history.replaceState(null, '', '/planned');
    onClose();
  });

  const source = sources.find((s) => s.id === sourceId);
  const isCard = source?.kind === 'CARD';
  const credit = isCard && (fn || 'CREDIT') === 'CREDIT';

  function submit() {
    void send(`planned/${plan.id}/confirm`, 'POST', {
      occurredOn,
      amount: toApiMoney(amount),
      categoryId: categoryId || null,
      accountId: source && !isCard ? source.id : null,
      cardId: isCard ? source!.id : null,
      cardFunction: isCard ? fn || 'CREDIT' : null,
      installmentCount: credit ? Math.max(1, Number(installments) || 1) : 1,
      destinationAccountId: plan.kind === 'TRANSFER' ? destinationId || null : null,
    });
  }

  return (
    <Dialog title={`Aconteceu: ${plan.description}`} onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <p className="text-[12px] text-[var(--color-muted)]">
          {KIND_LABEL[plan.kind]} prevista para {brDate(plan.expectedOn)} — {brl(plan.amount)}. Ajuste o que mudou; vira um lançamento normal.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Data em que aconteceu">
            <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={input} />
          </Field>
          <Field label="Valor real">
            <MoneyInput value={amount} onChange={setAmount} className={input} />
          </Field>
        </div>
        <SourcePicker
          label={plan.kind === 'INCOME' ? 'Em que conta recebeu' : plan.kind === 'TRANSFER' ? 'De qual conta saiu' : 'Como pagou'}
          sources={sources}
          value={sourceId}
          fn={fn}
          allowCards={plan.kind === 'EXPENSE'}
          onChange={(id, f) => {
            setSourceId(id);
            setFn(f);
          }}
        />
        {credit ? (
          <Field label="Parcelas" hint="1 = à vista">
            <input type="number" min={1} max={120} value={installments} onChange={(e) => setInstallments(e.target.value)} className={input} />
          </Field>
        ) : null}
        {plan.kind === 'TRANSFER' ? (
          <SourcePicker label="Para qual conta transferiu" sources={sources} value={destinationId} fn="" allowCards={false} onChange={(id) => setDestinationId(id)} />
        ) : (
          <Field label="Categoria">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={input}>
              <option value="">— sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Footer busy={busy} error={error} onClose={onClose} onSubmit={submit} label="Confirmar" />
      </div>
    </Dialog>
  );
}

/** "Não aconteceu": either it still will (a later date) or it never will. */
function MissedDialog({ plan, onClose }: { plan: Planned; onClose: () => void }) {
  const dayAfter = (() => {
    const d = new Date(`${plan.expectedOn}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return d.toLocaleDateString('sv-SE');
  })();
  const min = dayAfter > today() ? dayAfter : today();
  const [date, setDate] = useState(() => {
    const d = new Date(`${min}T00:00:00`);
    d.setMonth(d.getMonth() + 1); // a month later is the usual "next time"
    return d.toLocaleDateString('sv-SE');
  });
  const { busy, error, send } = useSubmit(() => {
    window.history.replaceState(null, '', '/planned');
    onClose();
  });

  return (
    <Dialog title={`Não aconteceu: ${plan.description}`} onClose={onClose}>
      <div className="flex flex-col gap-3.5">
        <p className="text-[12px] text-[var(--color-muted)]">
          Estava prevista para {brDate(plan.expectedOn)}. Ainda vai acontecer em outra data, ou não vai mais acontecer?
        </p>

        <div className="rounded-[10px] border border-[var(--color-line)] p-3.5">
          <div className="mb-2 text-[13px] font-semibold">Prorrogar</div>
          <div className="flex items-end gap-2">
            <Field label="Nova data prevista" hint={`A partir de ${brDate(min)}`}>
              <input type="date" min={min} value={date} onChange={(e) => setDate(e.target.value)} className={input} />
            </Field>
            <button
              type="button"
              disabled={busy || date < min}
              onClick={() => void send(`planned/${plan.id}/postpone`, 'POST', { expectedOn: date })}
              className="btn-accent mb-[18px] shrink-0 px-4 py-2 text-[13px] disabled:opacity-40"
            >
              Prorrogar
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--color-line)] p-3.5">
          <div>
            <div className="text-[13px] font-semibold">Não vai acontecer</div>
            <div className="text-[12px] text-[var(--color-muted)]">Fecha o previsto. Nada é lançado.</div>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(`planned/${plan.id}/cancel`, 'POST', {})}
            className="shrink-0 rounded-md border border-[var(--color-bad)]/40 px-3 py-2 text-[12px] font-semibold text-[var(--color-bad)] hover:bg-[var(--color-bad)]/8 disabled:opacity-40"
          >
            Não vai acontecer
          </button>
        </div>

        {error ? <p className="rounded-md bg-[var(--color-bad)]/8 px-3 py-2 text-[12px] font-medium text-[var(--color-bad)]">{error}</p> : null}
        <div className="flex justify-end border-t border-[var(--color-line)] pt-3.5">
          <button type="button" onClick={onClose} className="rounded-md px-3.5 py-2 text-[13px] text-[var(--color-ink-2)] hover:bg-[var(--color-well)]">
            Voltar
          </button>
        </div>
      </div>
    </Dialog>
  );
}

function Footer({ busy, error, onClose, onSubmit, label }: { busy: boolean; error: string | null; onClose: () => void; onSubmit: () => void; label: string }) {
  return (
    <>
      {error ? <p className="rounded-md bg-[var(--color-bad)]/8 px-3 py-2 text-[12px] font-medium text-[var(--color-bad)]">{error}</p> : null}
      <div className="mt-1 flex justify-end gap-2 border-t border-[var(--color-line)] pt-3.5">
        <button type="button" onClick={onClose} className="rounded-md px-3.5 py-2 text-[13px] text-[var(--color-ink-2)] hover:bg-[var(--color-well)]">
          Cancelar
        </button>
        <button type="button" onClick={onSubmit} disabled={busy} className="btn-accent px-4 py-2 text-[13px] disabled:opacity-40">
          {busy ? '…' : label}
        </button>
      </div>
    </>
  );
}

const input =
  'w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]';
const iconBtn =
  'inline-grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition hover:bg-[var(--color-surface)] hover:text-[var(--color-accent)]';
