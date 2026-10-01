'use client';

import { useRouter } from 'next/navigation';

import { MoneyInput } from '@/components/ui/money-input';
import { displayMoney, toApiMoney } from '@/lib/money-input';
import { useState } from 'react';

import { EditIcon, PlusIcon } from '@/components/ui/icons';

/** Normalise a money field to exactly two decimals ("300" → "300.00"); the API
 *  demands it. Leave anything unparseable for the API to reject clearly. */
/**
 * A single configurable create/edit dialog, used for every entity.
 *
 * It renders a typed set of fields, builds the request body, and calls the
 * authenticated proxy (which forwards to the Nest API). The API owns every
 * rule — this only collects input and reports the API's refusal. One component
 * instead of a dozen near-identical forms.
 */
/**
 * `emptyAs` settles what a blank field means to the API, which is NOT one
 * thing: a nullable column wants `null`, while a field the schema defaults
 * (`initialBalance`, `currency`) must be OMITTED — zod's `.default()` fires on
 * `undefined` only, so sending `null` is rejected outright. Defaults to
 * `'null'`, which is what every nullable field wants.
 */
type Empty = { emptyAs?: 'null' | 'omit' };

export type Field = Empty &
  (
    | { name: string; label: string; type: 'text' | 'money' | 'date'; value?: string; hint?: string; required?: boolean }
    | { name: string; label: string; type: 'number'; value?: number; hint?: string }
    | { name: string; label: string; type: 'checkbox'; value?: boolean; hint?: string }
    | { name: string; label: string; type: 'select'; value?: string; options: { value: string; label: string }[]; hint?: string }
  );

export function EntityForm({
  trigger,
  title,
  method,
  path,
  fields,
  submitLabel = 'Salvar',
  extra,
}: {
  trigger: React.ReactNode;
  title: string;
  method: 'POST' | 'PATCH';
  path: string;
  fields: Field[];
  submitLabel?: string;
  /**
   * Static extra values merged into the body (e.g. a computed periodStart).
   * A plain object, not a function — functions cannot cross the server/client
   * boundary, so the field values are coerced generically by type instead.
   */
  extra?: Record<string, unknown>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /*
   * A select starts on its FIRST OPTION, not on ''. A <select> whose value
   * matches no option still paints the first one, so an empty initial state
   * looks chosen while submitting null — "Tipo" read "Conta bancária" and the
   * API was refused for a missing type.
   */
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        if (f.value !== undefined)
          return [f.name, f.type === 'money' ? displayMoney(String(f.value)) : f.value];
        if (f.type === 'checkbox') return [f.name, false];
        if (f.type === 'select') return [f.name, f.options[0]?.value ?? ''];
        return [f.name, ''];
      }),
    ),
  );

  const set = (name: string, v: unknown) => setValues((s) => ({ ...s, [name]: v }));

  // The form stays mounted across router.refresh(), so a select's initial state
  // can predate its options (the first account created after the page loaded):
  // fall back to the option the <select> actually paints.
  const valueOf = (f: Field): unknown => {
    const v = values[f.name];
    if (f.type === 'select' && !f.options.some((o) => o.value === v)) return f.options[0]?.value ?? '';
    return v;
  };

  async function submit(): Promise<void> {
    // The dialog submits from a plain button, so nothing native enforces
    // `required` — check it here, or a blank name reaches the API and comes
    // back as an opaque VALIDATION_FAILED.
    const missing = fields.find(
      (f) => 'required' in f && f.required && String(values[f.name] ?? '').trim() === '',
    );
    if (missing) {
      setError(`${missing.label}: obrigatório`);
      return;
    }

    setBusy(true);
    setError(null);

    // Coerce each field by its type: money → string, number → number,
    // checkbox → boolean. A blank field becomes `null`, or is left out
    // entirely when the schema has a default to apply (see `emptyAs`).
    const body: Record<string, unknown> = { ...extra };
    for (const field of fields) {
      const raw = valueOf(field);
      const blank = raw === '' || raw === undefined || raw === null;

      if (field.type === 'checkbox') {
        body[field.name] = Boolean(raw);
        continue;
      }
      if (blank) {
        if (field.emptyAs !== 'omit') body[field.name] = null;
        continue;
      }
      if (field.type === 'number') body[field.name] = Number(raw);
      else if (field.type === 'money') body[field.name] = toApiMoney(String(raw));
      else body[field.name] = raw;
    }
    const res = await fetch(`/api/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      const b = (await res.json().catch(() => ({}))) as { detail?: unknown; code?: string };
      setError(readError(b));
    }
    setBusy(false);
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="contents">
        {trigger}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="w-full max-w-[440px] rounded-[14px] border border-[var(--color-line)] bg-[var(--color-surface)] p-5 shadow-[0_16px_40px_rgba(0,0,0,0.2)]">
            <h2 className="mb-4 text-[16px] font-semibold">{title}</h2>
            <div className="flex flex-col gap-3.5">
              {fields.map((field) => (
                <label key={field.name} className="flex flex-col gap-1">
                  <span className="text-[12px] font-semibold text-[var(--color-ink-2)]">
                    {field.label}
                  </span>
                  {field.type === 'select' ? (
                    <select
                      value={String(valueOf(field) ?? '')}
                      onChange={(e) => set(field.name, e.target.value)}
                      className={input}
                    >
                      {field.options.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'money' ? (
                    <MoneyInput
                      value={String(values[field.name] ?? '')}
                      onChange={(next) => set(field.name, next)}
                      className={input}
                    />
                  ) : field.type === 'checkbox' ? (
                    <span className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(values[field.name])}
                        onChange={(e) => set(field.name, e.target.checked)}
                        className="accent-[var(--color-accent)]"
                      />
                      <span className="text-[13px] text-[var(--color-ink-2)]">{field.hint}</span>
                    </span>
                  ) : (
                    <input
                      type={field.type === 'date' ? 'date' : 'text'}
                      inputMode={field.type === 'number' ? 'decimal' : undefined}
                      value={String(values[field.name] ?? '')}
                      onChange={(e) => set(field.name, e.target.value)}
                      className={input}
                    />
                  )}
                  {field.type !== 'checkbox' && field.hint ? (
                    <span className="text-[11px] text-[var(--color-muted)]">{field.hint}</span>
                  ) : null}
                </label>
              ))}

              {error ? (
                <p className="rounded-md bg-[var(--color-bad)]/8 px-3 py-2 text-[12px] font-medium text-[var(--color-bad)]">
                  {error}
                </p>
              ) : null}

              <div className="mt-1 flex justify-end gap-2 border-t border-[var(--color-line)] pt-3.5">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md px-3.5 py-2 text-[13px] text-[var(--color-ink-2)] hover:bg-[var(--color-well)]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={busy}
                  className="btn-accent px-4 py-2 text-[13px] disabled:opacity-40"
                >
                  {busy ? '…' : submitLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

const input =
  'w-full rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-3 py-2 text-[13px] outline-none focus:border-[var(--color-accent)]';

/** A pill-style "+ New" trigger, matching the sidebar accent button. */
export function NewButton({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[10px] border border-[var(--color-accent)] px-3 py-1.5 text-[13px] font-semibold text-[var(--color-accent)] transition hover:bg-[var(--color-accent-soft)]">
      <PlusIcon size={14} /> {label}
    </span>
  );
}

/** An edit icon trigger for a row. */
export function EditButton({ title = 'Editar' }: { title?: string }) {
  return (
    <span
      title={title}
      aria-label={title}
      className="inline-grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] transition hover:bg-[var(--color-well)] hover:text-[var(--color-accent)]"
    >
      <EditIcon />
    </span>
  );
}

/**
 * The API answers with a code and, for a schema refusal, the zod issues. A
 * bare "VALIDATION_FAILED" tells the user nothing — name the field that was
 * refused instead.
 */
function readError(body: { detail?: unknown; code?: string }): string {
  if (typeof body.detail === 'string') return body.detail;

  const issues = (body.detail as { issues?: { path?: unknown[]; message?: string }[] } | undefined)?.issues;
  const first = issues?.[0];
  if (first) {
    const field = Array.isArray(first.path) ? first.path.join('.') : '';
    return field ? `${field}: ${first.message ?? 'inválido'}` : (first.message ?? 'inválido');
  }
  return body.code ?? 'falhou';
}
