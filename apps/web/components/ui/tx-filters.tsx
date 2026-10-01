'use client';

import { useRouter, useSearchParams } from 'next/navigation';

export interface FilterOption {
  value: string;
  label: string;
}

/**
 * The transactions screen narrowed by where the money moved and what it was
 * for. Every choice goes into the URL (ARCH06) so a filtered list is linkable
 * and the back button undoes one step at a time.
 *
 * The account and card lists are not narrowed by the chosen wallet on purpose:
 * picking a card whose account sits elsewhere should show that card, not an
 * empty screen — the API treats the filters as an intersection and says so by
 * returning nothing.
 */
export function TxFilters({
  wallets,
  accounts,
  cards,
  categories,
  kinds,
  occurrences,
  labels,
}: {
  wallets: FilterOption[];
  accounts: FilterOption[];
  cards: FilterOption[];
  categories: FilterOption[];
  kinds: FilterOption[];
  occurrences: FilterOption[];
  labels: {
    wallet: string;
    account: string;
    card: string;
    category: string;
    kind: string;
    occurrence: string;
    all: string;
    clear: string;
    uncategorized: string;
  };
}) {
  const router = useRouter();
  const params = useSearchParams();

  const set = (key: string, value: string): void => {
    const query = new URLSearchParams(params.toString());
    if (value === '') query.delete(key);
    else query.set(key, value);
    router.push(`/transactions?${query.toString()}`);
  };

  const active = ['wallets', 'account', 'card', 'category', 'kind', 'occurrence'].filter((k) =>
    params.get(k),
  );

  const field = (
    key: string,
    label: string,
    options: FilterOption[],
    extra?: FilterOption,
  ) => (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="label">{label}</span>
      <select
        value={params.get(key) ?? ''}
        onChange={(event) => set(key, event.target.value)}
        className="min-w-0 rounded-[10px] border border-[var(--color-rule)] bg-[var(--color-surface)] px-2.5 py-1.5 text-[12.5px] outline-none transition focus:border-[var(--color-accent)]"
      >
        <option value="">{labels.all}</option>
        {extra ? <option value={extra.value}>{extra.label}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="tile mb-3 flex flex-wrap items-end gap-3 p-3">
      {field('wallets', labels.wallet, wallets)}
      {field('account', labels.account, accounts)}
      {field('card', labels.card, cards)}
      {field('category', labels.category, categories, {
        value: 'none',
        label: labels.uncategorized,
      })}
      {field('kind', labels.kind, kinds)}
      {field('occurrence', labels.occurrence, occurrences)}

      {active.length > 0 ? (
        <button
          type="button"
          onClick={() => {
            const query = new URLSearchParams(params.toString());
            for (const key of active) query.delete(key);
            router.push(`/transactions?${query.toString()}`);
          }}
          className="rounded-full bg-[var(--color-well)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-ink-2)] transition hover:text-[var(--color-ink)]"
        >
          {labels.clear} ({active.length})
        </button>
      ) : null}
    </div>
  );
}
