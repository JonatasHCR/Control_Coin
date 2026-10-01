'use client';

import { useActionState, useMemo, useState } from 'react';

import { add, money, sub, type Money as MoneyString } from '@cc/domain/money';

import { MoneyInput } from '@/components/ui/money-input';
import { displayMoney, toApiMoney } from '@/lib/money-input';

export interface FormState {
  error?: string;
}

export interface Source {
  id: string;
  label: string;
  kind: 'ACCOUNT' | 'CARD';
  functions: ('CREDIT' | 'DEBIT')[];
}

type Kind = 'EXPENSE' | 'INCOME' | 'TRANSFER';
type Frequency = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Part {
  sourceId: string;
  cardFunction: 'CREDIT' | 'DEBIT' | '';
  amount: string;
  installmentCount: number;
}

/** Prefilled values when editing an existing transaction. */
export interface TransactionInitial {
  kind: Kind;
  description: string;
  occurredOn: string;
  categoryId: string;
  total: string;
  recurring: boolean;
  frequency: Frequency;
  intervalCount: number;
  endsOn: string;
  sourceParts: Part[];
  destParts: Part[];
}

/**
 * The new-transaction form. Three controls are independent:
 *
 *  - kind — expense (source only), income (destination only), transfer (both);
 *  - occurrence — occasional, recurring (carries a frequency), or installment
 *    (a credit part paid in N×);
 *  - source — an account, or a card plus the function used.
 *
 * It builds the whole request body client-side and hands it to the server
 * action as one JSON field, so the reactive split arithmetic (BR12/BR36) lives
 * in one place. The API re-checks every rule — this only collects the input.
 */
export function TransactionForm({
  sources,
  categories,
  action,
  initial,
  submitLabel = 'Salvar lançamento',
}: {
  sources: Source[];
  categories: { id: string; name: string }[];
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  initial?: TransactionInitial;
  submitLabel?: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const accounts = useMemo(() => sources.filter((s) => s.kind === 'ACCOUNT'), [sources]);

  const [kind, setKind] = useState<Kind>(initial?.kind ?? 'EXPENSE');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [occurredOn, setOccurredOn] = useState(initial?.occurredOn ?? new Date().toISOString().slice(0, 10));
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '');
  const [total, setTotal] = useState(displayMoney(initial?.total ?? ''));

  const [recurring, setRecurring] = useState(initial?.recurring ?? false);
  const [frequency, setFrequency] = useState<Frequency>(initial?.frequency ?? 'MONTHLY');
  const [intervalCount, setIntervalCount] = useState(initial?.intervalCount ?? 1);
  const [endsOn, setEndsOn] = useState(initial?.endsOn ?? '');

  const [sourceParts, setSourceParts] = useState<Part[]>(
    initial?.sourceParts?.length ? initial.sourceParts : [blank(sources, sources[0]?.id)],
  );
  const [destParts, setDestParts] = useState<Part[]>(
    initial?.destParts?.length ? initial.destParts : [blank(accounts, accounts[0]?.id)],
  );

  // Which sides this kind uses, and what each side may contain.
  const usesSource = kind === 'EXPENSE' || kind === 'TRANSFER';
  const usesDest = kind === 'INCOME' || kind === 'TRANSFER';
  // A transfer moves money between accounts; a credit card can never be a
  // source (debt cannot pay debt, BR31). Expense sources may be any card.
  const sourceOptions = kind === 'EXPENSE' ? sources : accounts;
  const allowFunction = kind === 'EXPENSE';
  const allowInstallments = kind === 'EXPENSE' && !recurring;

  const totalMoney = safeMoney(total);
  const sourceSum = sumParts(sourceParts);
  const destSum = sumParts(destParts);

  const sourceOk = !usesSource || sourceSum === totalMoney;
  const destOk = !usesDest || destSum === totalMoney;
  const balanced = sourceOk && destOk && totalMoney !== '0.00';

  const occurrenceType: 'OCCASIONAL' | 'RECURRING' | 'INSTALLMENT' = recurring
    ? 'RECURRING'
    : sourceParts.some((p) => p.installmentCount > 1)
      ? 'INSTALLMENT'
      : 'OCCASIONAL';

  const payload = useMemo(() => {
    const entries: Record<string, unknown>[] = [];
    if (usesSource) {
      for (const p of sourceParts) entries.push(entryOf(p, 'SOURCE', sources, allowInstallments));
    }
    if (usesDest) {
      for (const p of destParts) entries.push(entryOf(p, 'DESTINATION', sources, false));
    }
    return JSON.stringify({
      kind,
      occurrenceType,
      categoryId: kind === 'TRANSFER' ? null : categoryId || null,
      description: description || undefined,
      occurredOn,
      totalAmount: totalMoney,
      currency: 'BRL',
      entries,
      recurrence: recurring
        ? { frequency, intervalCount, endsOn: endsOn || null }
        : undefined,
    });
  }, [
    kind, occurrenceType, categoryId, description, occurredOn, totalMoney, usesSource, usesDest,
    sourceParts, destParts, sources, allowInstallments, recurring, frequency, intervalCount, endsOn,
  ]);

  const kinds: { value: Kind; label: string }[] = [
    { value: 'EXPENSE', label: 'Despesa' },
    { value: 'INCOME', label: 'Receita' },
    { value: 'TRANSFER', label: 'Transferência' },
  ];

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="payload" value={payload} />

      {/* Kind — the segmented control at the top. */}
      <div className="flex gap-1 rounded-[10px] bg-[var(--color-well)] p-1">
        {kinds.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => setKind(k.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-[13px] font-semibold transition ${
              kind === k.value
                ? 'bg-[var(--color-surface)] text-[var(--color-accent)] shadow-sm'
                : 'text-[var(--color-muted)] hover:text-[var(--color-ink)]'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <Field label="Descrição">
        <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ex.: Supermercado" className={inputClass} />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Data">
          <input type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} className={inputClass} />
        </Field>

        {kind === 'TRANSFER' ? (
          <div className="flex items-end pb-2 text-[12px] text-[var(--color-muted)]">
            Transferência não consome orçamento nem entra no custo de vida.
          </div>
        ) : (
          <Field label="Categoria — opcional">
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={inputClass}>
              {/* BR01: no category is a legitimate outcome, not a failure. */}
              <option value="">Sem categoria</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </Field>
        )}
      </div>

      <Field label="Valor total">
        <MoneyInput value={total} onChange={setTotal} placeholder="0,00" className={inputClass} />
      </Field>

      {/* Recurrence — occurrence is independent of kind. */}
      <div className="rounded-[10px] border border-[var(--color-line)] p-3">
        <label className="flex items-center gap-2 text-[13px] font-semibold">
          <input
            type="checkbox"
            checked={recurring}
            onChange={(e) => setRecurring(e.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Recorrente
        </label>
        {recurring ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Frequência">
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)} className={inputClass}>
                <option value="WEEKLY">Semanal</option>
                <option value="MONTHLY">Mensal</option>
                <option value="YEARLY">Anual</option>
              </select>
            </Field>
            <Field label="A cada">
              <input
                type="number"
                min={1}
                value={intervalCount}
                onChange={(e) => setIntervalCount(Math.max(1, Number(e.target.value) || 1))}
                className={inputClass}
              />
            </Field>
            <Field label="Termina em — opcional">
              <input type="date" value={endsOn} onChange={(e) => setEndsOn(e.target.value)} className={inputClass} />
            </Field>
          </div>
        ) : null}
        {recurring ? (
          <p className="mt-2 text-[11px] text-[var(--color-muted)]">
            Uma recorrência não pode ser parcelada — as parcelas ficam em 1×.
          </p>
        ) : null}
      </div>

      {usesSource ? (
        <SideEditor
          title={kind === 'TRANSFER' ? 'De' : 'Pago com'}
          parts={sourceParts}
          setParts={setSourceParts}
          sources={sourceOptions}
          allowFunction={allowFunction}
          allowInstallments={allowInstallments}
          total={totalMoney}
          balanced={sourceOk}
        />
      ) : null}

      {usesDest ? (
        <SideEditor
          title={kind === 'TRANSFER' ? 'Para' : 'Recebido em'}
          parts={destParts}
          setParts={setDestParts}
          sources={accounts}
          allowFunction={false}
          allowInstallments={false}
          total={totalMoney}
          balanced={destOk}
        />
      ) : null}

      {state.error ? (
        <p className="rounded-md bg-[var(--color-bad)]/10 px-3 py-2 text-[12px] font-medium text-[var(--color-bad)]">
          {state.error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={!balanced}
        className="btn-accent self-end px-4 py-2.5 text-[13px] disabled:opacity-40"
      >
        {submitLabel}
      </button>
    </form>
  );
}

/** One side of the transaction — a list of parts that must sum to the total. */
function SideEditor({
  title,
  parts,
  setParts,
  sources,
  allowFunction,
  allowInstallments,
  total,
  balanced,
}: {
  title: string;
  parts: Part[];
  setParts: React.Dispatch<React.SetStateAction<Part[]>>;
  sources: Source[];
  allowFunction: boolean;
  allowInstallments: boolean;
  total: MoneyString;
  balanced: boolean;
}) {
  const allocated = sumParts(parts);
  const remainder = sub(total, allocated);

  const update = (index: number, patch: Partial<Part>): void =>
    setParts((current) => current.map((p, i) => (i === index ? { ...p, ...patch } : p)));

  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        {title}
      </span>

      {parts.map((part, index) => {
        const source = sources.find((s) => s.id === part.sourceId);
        const isCard = source?.kind === 'CARD';
        return (
          <div key={index}>
            <div className="grid grid-cols-[1fr_6.5rem_5.5rem_2rem] items-center gap-2">
              <select
                value={part.sourceId}
                onChange={(e) =>
                  update(index, {
                    sourceId: e.target.value,
                    cardFunction: firstFunction(sources, e.target.value),
                  })
                }
                className={inputClass}
              >
                {sources.length === 0 ? <option value="">—</option> : null}
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>

              <select
                value={part.cardFunction}
                onChange={(e) => update(index, { cardFunction: e.target.value as Part['cardFunction'] })}
                disabled={!allowFunction || !isCard}
                className={inputClass}
              >
                {allowFunction && isCard ? (
                  source!.functions.map((f) => (
                    <option key={f} value={f}>{f === 'CREDIT' ? 'crédito' : 'débito'}</option>
                  ))
                ) : (
                  <option value="">—</option>
                )}
              </select>

              <MoneyInput
                value={part.amount}
                onChange={(next) => update(index, { amount: next })}
                className={inputClass}
              />

              <button
                type="button"
                onClick={() => setParts((c) => c.filter((_, i) => i !== index))}
                disabled={parts.length === 1}
                className="grid h-9 place-items-center rounded-md bg-[var(--color-well)] text-[var(--color-muted)] disabled:opacity-40"
              >
                ×
              </button>
            </div>

            {allowInstallments && isCard && part.cardFunction === 'CREDIT' ? (
              <div className="mt-1 pl-1 text-[11px] text-[var(--color-muted)]">
                parcelas:{' '}
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={part.installmentCount}
                  onChange={(e) =>
                    update(index, { installmentCount: clampInstallments(e.target.value) })
                  }
                  className="w-14 rounded border border-[var(--color-rule)] bg-transparent px-1.5 py-0.5 text-center"
                />
                ×{' '}
                {part.installmentCount > 1 ? `de ${divide(part.amount, part.installmentCount)}` : 'à vista'}
              </div>
            ) : null}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setParts((c) => [...c, blank(sources, sources[0]?.id)])}
        className="self-start text-xs font-semibold text-[var(--color-accent)]"
      >
        + dividir
      </button>

      {/* BR12 made visible per side: the parts must sum exactly to the total. */}
      <div
        className={`flex items-center justify-between rounded-md px-3 py-2 text-xs tabular ${
          balanced
            ? 'bg-[var(--color-positive)]/10 text-[var(--color-positive)]'
            : 'bg-[var(--color-bad)]/10 text-[var(--color-bad)]'
        }`}
      >
        <span>partes <b>{allocated}</b> de <b>{total}</b></span>
        <span className="font-semibold">{balanced ? '✓ fecha' : `falta ${remainder}`}</span>
      </div>
    </div>
  );
}

const inputClass =
  'w-full rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">{label}</span>
      {children}
    </label>
  );
}

/**
 * A card part starts on the card's FIRST function, never on ''. A <select>
 * whose value matches no option still paints the first one, so an empty
 * cardFunction looked like "crédito" on screen while the instalment row (which
 * needs CREDIT) stayed hidden and the entry went out as DEBIT — a credit
 * purchase settling against the account instead of the invoice (BR07).
 */
function firstFunction(sources: Source[], sourceId: string | undefined): Part['cardFunction'] {
  const source = sources.find((s) => s.id === sourceId);
  return source?.kind === 'CARD' ? (source.functions[0] ?? '') : '';
}

function blank(sources: Source[], sourceId?: string): Part {
  const id = sourceId ?? '';
  return { sourceId: id, cardFunction: firstFunction(sources, id), amount: '0,00', installmentCount: 1 };
}

/** Build one API entry from a part; the account/card union is decided by source kind. */
function entryOf(
  p: Part,
  side: 'SOURCE' | 'DESTINATION',
  sources: Source[],
  allowInstallments: boolean,
): Record<string, unknown> {
  const source = sources.find((s) => s.id === p.sourceId);
  const installmentCount = allowInstallments ? p.installmentCount : 1;
  // Send the normalised amount ("500" → "500.00"): the API's money schema
  // demands exactly two fraction digits, and the raw field may hold neither.
  const amount = safeMoney(p.amount);
  if (source?.kind === 'CARD') {
    return {
      side,
      cardId: p.sourceId,
      cardFunction: p.cardFunction,
      amount,
      installmentCount,
    };
  }
  return { side, accountId: p.sourceId, amount, installmentCount: 1 };
}

function sumParts(parts: readonly Part[]): MoneyString {
  return parts.reduce<MoneyString>((s, p) => add(s, safeMoney(p.amount)), money('0'));
}

/** The field holds a pt-BR spelling; the domain only parses `1234.56`. */
function safeMoney(raw: string): MoneyString {
  try {
    const api = toApiMoney(raw);
    return money(api === '' ? '0' : api);
  } catch {
    return money('0');
  }
}

function divide(amount: string, parts: number): string {
  try {
    const cents = Math.round(Number(safeMoney(amount)) * 100);
    return (Math.floor(cents / parts) / 100).toFixed(2);
  } catch {
    return '0.00';
  }
}

/** The schema allows 1 to 120 instalments; anything else is a typo, not intent. */
function clampInstallments(raw: string): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 120);
}
