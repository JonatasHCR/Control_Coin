import Link from 'next/link';

import { AppShell } from '@/components/app-shell';
import { EditButton } from '@/components/forms/entity-form';
import { DeleteButton } from '@/components/row-actions';
import { Card, CardHead } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { PeriodNav } from '@/components/ui/period-nav';
import { PeriodRange } from '@/components/ui/period-range';
import { Toolbar } from '@/components/ui/toolbar';
import { TxFilters } from '@/components/ui/tx-filters';
import { apiFetch, type AccountTree, type CategoryRow, type TransactionRow } from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    period?: string;
    wallets?: string;
    account?: string;
    card?: string;
    category?: string;
    kind?: string;
    occurrence?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const locale = await getLocale();
  const {
    period = new Date().toISOString().slice(0, 7),
    wallets,
    account,
    card,
    category,
    kind,
    occurrence,
    from,
    to,
  } = await searchParams;

  const query = new URLSearchParams({ period });
  if (wallets) query.set('wallets', wallets);
  if (account) query.set('account', account);
  if (card) query.set('card', card);
  if (category) query.set('category', category);
  if (kind) query.set('kind', kind);
  if (occurrence) query.set('occurrence', occurrence);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const ranged = Boolean(from || to);

  const [rows, tree, categories] = await Promise.all([
    apiFetch<TransactionRow[]>(`/transactions?${query.toString()}`),
    apiFetch<AccountTree>('/accounts'),
    apiFetch<CategoryRow[]>('/categories'),
  ]);

  const allAccounts = [
    ...tree.wallets.flatMap((w) => w.accounts.map((a) => ({ ...a, wallet: w.name }))),
    ...tree.unassigned.map((a) => ({ ...a, wallet: null as string | null })),
  ];

  return (
    <AppShell>
      <Toolbar title={t(locale, 'tx.title')} locale={locale}>
        {ranged ? null : <PeriodNav period={period} basePath="/transactions" locale={locale} />}
        <PeriodRange
          period={period}
          labels={{
            month: t(locale, 'period.month'),
            year: t(locale, 'period.year'),
            range: t(locale, 'period.range'),
            from: t(locale, 'period.from'),
            to: t(locale, 'period.to'),
          }}
        />
      </Toolbar>

      <TxFilters
        wallets={tree.wallets.map((w) => ({ value: w.id, label: w.name }))}
        accounts={allAccounts.map((a) => ({
          value: a.id,
          label: a.wallet ? `${a.wallet} › ${a.name}` : a.name,
        }))}
        cards={allAccounts.flatMap((a) =>
          a.cards.map((c) => ({ value: c.id, label: `${c.name} · ${a.name}` })),
        )}
        categories={categories.map((c) => ({ value: c.id, label: c.name }))}
        kinds={(['EXPENSE', 'INCOME', 'TRANSFER'] as const).map((k) => ({
          value: k,
          label: t(locale, `kind.${k}`),
        }))}
        occurrences={(['OCCASIONAL', 'RECURRING', 'INSTALLMENT'] as const).map((o) => ({
          value: o,
          label: t(locale, `occ.${o}`),
        }))}
        labels={{
          wallet: t(locale, 'filter.wallet'),
          account: t(locale, 'filter.account'),
          card: t(locale, 'filter.card'),
          category: t(locale, 'filter.category'),
          kind: t(locale, 'filter.kind'),
          occurrence: t(locale, 'filter.occurrence'),
          all: t(locale, 'filter.all'),
          clear: t(locale, 'filter.clear'),
          uncategorized: t(locale, 'filter.none'),
        }}
      />

      <Card>
        <CardHead title={ranged ? `${from ?? '…'} → ${to ?? '…'}` : period} note={`${rows.length}`} />
        {rows.length === 0 ? (
          <p className="text-[13px] text-[var(--color-muted)]">{t(locale, 'tx.empty')}</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-[var(--color-line)] text-left text-[11px] uppercase tracking-wide text-[var(--color-muted)]">
                <th className="pb-2">{t(locale, 'col.date')}</th>
                <th className="pb-2">{t(locale, 'col.type')}</th>
                <th className="pb-2">{t(locale, 'tx.title')}</th>
                <th className="pb-2">{t(locale, 'col.category')}</th>
                <th className="pb-2">{t(locale, 'col.paidWith')}</th>
                <th className="pb-2 text-right">{t(locale, 'col.amount')}</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((tx) => (
                <tr key={tx.id} className="border-b border-[var(--color-line)] align-top last:border-0">
                  <td className="py-3">{tx.occurredOn.slice(8, 10)}/{tx.occurredOn.slice(5, 7)}</td>
                  <td className="py-3">
                    <KindChip kind={tx.kind} label={t(locale, `kind.${tx.kind}`)} />
                  </td>
                  <td className="py-3">
                    <span className="font-medium">{tx.description ?? '—'}</span>
                    {tx.entries.length > 1 ? (
                      <span className="ml-2 rounded-full bg-[var(--color-well)] px-2 py-px text-[11px] font-semibold text-[var(--color-ink-2)]">
                        {t(locale, 'tx.split')}
                      </span>
                    ) : null}
                    {tx.occurrenceType === 'RECURRING' ? (
                      <span className="ml-2 rounded-full bg-[var(--color-well)] px-2 py-px text-[11px] font-semibold text-[var(--color-ink-2)]">
                        ↻ {t(locale, 'tx.recurring')}
                      </span>
                    ) : null}
                    {tx.occurrenceType === 'INSTALLMENT' ? (
                      <span className="ml-2 rounded-full bg-[var(--color-well)] px-2 py-px text-[11px] font-semibold text-[var(--color-ink-2)]">
                        {t(locale, 'tx.installment')}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3">
                    {tx.category ? (
                      <span className="rounded-full bg-[var(--color-well)] px-2 py-px text-[11px] font-semibold">
                        {tx.category.name}
                      </span>
                    ) : (
                      /* BR01: shown, never dropped */
                      <span className="rounded-full border border-dashed border-[var(--color-rule)] px-2 py-px text-[11px] text-[var(--color-muted)]">
                        {t(locale, 'cat.uncategorized')}
                      </span>
                    )}
                  </td>
                  <td className="py-3">
                    {tx.entries.map((e) => (
                      <div key={e.id} className="text-[12px] text-[var(--color-muted)]">
                        {e.card?.name ?? e.account?.name}
                        {e.cardFunction ? ` · ${e.cardFunction.toLowerCase()}` : ''}
                        {e.installmentCount > 1 ? ` · ${e.installmentCount}×` : ''}{' '}
                        <Money value={e.amount} locale={locale} />
                      </div>
                    ))}
                  </td>
                  <td className="py-3 text-right font-medium">
                    <Money value={tx.totalAmount} locale={locale} />
                  </td>
                  <td className="py-3 pl-3 text-right">
                    <span className="inline-flex items-center gap-1">
                      <Link href={`/transactions/${tx.id}/edit`} className="contents">
                        <EditButton />
                      </Link>
                      <DeleteButton
                        path={`transactions/${tx.id}`}
                        confirmLabel="Excluir este lançamento? As parcelas e movimentos vão junto."
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </AppShell>
  );
}

/** A colour-coded badge for the transaction kind: expense, income, transfer. */
function KindChip({ kind, label }: { kind: 'EXPENSE' | 'INCOME' | 'TRANSFER'; label: string }) {
  const tone = {
    EXPENSE: 'bg-[var(--color-series-2)]/12 text-[var(--color-series-2)]',
    INCOME: 'bg-[var(--color-good)]/15 text-[var(--color-positive)]',
    TRANSFER: 'bg-[var(--color-accent-soft)] text-[var(--color-accent)]',
  }[kind];
  return (
    <span className={`inline-block rounded-full px-2 py-px text-[11px] font-semibold ${tone}`}>
      {label}
    </span>
  );
}
