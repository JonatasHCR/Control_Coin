import { AppShell } from '@/components/app-shell';
import { BarList } from '@/components/charts/bar-list';
import { Ledger } from '@/components/ledger';
import { Callout, Card, CardHead, Chip } from '@/components/ui/card';
import { Flow, FlowOp, FlowStep } from '@/components/ui/flow';
import { Money } from '@/components/ui/money';
import { PeriodNav } from '@/components/ui/period-nav';
import { ScopePicker } from '@/components/ui/scope-picker';
import { Toolbar } from '@/components/ui/toolbar';
import { apiFetch, type AccountTree, type Dashboard, type TransactionRow } from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

/**
 * A server component: the dashboard is almost entirely aggregate reads, so it
 * is two parallel round trips rather than a waterfall of client fetches after
 * hydration. The ledger is the second one — the aggregates never carry the
 * individual movements.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; scope?: string }>;
}) {
  const locale = await getLocale();
  const { period = new Date().toISOString().slice(0, 7), scope = 'all' } = await searchParams;

  const walletQuery = scope === 'all' ? '' : `&wallets=${scope}`;
  const [data, transactions, tree] = await Promise.all([
    apiFetch<Dashboard>(`/reports/dashboard?period=${period}&scope=${scope}`),
    apiFetch<TransactionRow[]>(`/transactions?period=${period}${walletQuery}`),
    apiFetch<AccountTree>('/accounts'),
  ]);

  const balance = data.balance;
  const essential = data.essentialCost;
  const committed = data.invoices.reduce((sum, i) => sum + Number(i.open_amount), 0).toFixed(2);
  const overdue = data.invoices.filter((i) => i.is_overdue);
  const spent = data.categories.reduce((sum, c) => sum + Number(c.total), 0).toFixed(2);

  return (
    <AppShell>
      <Toolbar
        title={t(locale, 'nav.dashboard')}
        subtitle={
          scope === 'all'
            ? t(locale, 'scope.all')
            : scope
                .split(',')
                .map((id) => tree.wallets.find((w) => w.id === id)?.name ?? id)
                .join(' + ')
        }
        locale={locale}
      >
        <PeriodNav period={data.period} basePath="/" locale={locale} />
        <ScopePicker
          wallets={tree.wallets.map((w) => ({ id: w.id, name: w.name }))}
          scope={scope}
          label={t(locale, 'scope.pick')}
          generalLabel={t(locale, 'scope.general')}
        />
      </Toolbar>

      {/*
        The period as one sentence: the equation, then the two figures that are
        NOT part of it — committed money and the standing monthly cost. Keeping
        them in the same strip but past the `=` is what stops either being read
        as part of the month's arithmetic.
      */}
      {balance ? (
        <Flow>
          <FlowStep
            variant="in"
            label={t(locale, 'period.income')}
            tag={t(locale, 'period.thisMonth')}
            value={<Money value={balance.income} locale={locale} />}
          />
          <FlowOp>−</FlowOp>
          <FlowStep
            variant="out"
            label={t(locale, 'period.expenses')}
            tag={t(locale, 'period.thisMonth')}
            value={<Money value={balance.expenses} locale={locale} />}
            note={t(locale, 'period.settledOnly')}
          />
          <FlowOp>=</FlowOp>
          {/* The month on its own: the carried balance (BR34) is left out of the strip. */}
          <FlowStep
            variant="result"
            label={t(locale, 'period.result')}
            value={<Money value={(Number(balance.income) - Number(balance.expenses)).toFixed(2)} locale={locale} />}
            note={t(locale, 'period.resultNote')}
          />
          <FlowStep
            label={t(locale, 'stat.committed')}
            value={<Money value={committed} locale={locale} />}
            note={t(locale, 'stat.committedNote')}
          />
          {/* BR14: the month's essential spending, and the year's monthly average beside it. */}
          <FlowStep
            label={t(locale, 'cost.title')}
            tag={t(locale, 'cost.essentialTag')}
            value={<Money value={essential.month_essential} locale={locale} />}
            note={
              <>
                {t(locale, 'cost.yearAverage')} ({essential.months} {essential.months === 1 ? t(locale, 'cost.month') : t(locale, 'cost.months')}):{' '}
                <strong className="text-[var(--color-ink-2)]">
                  <Money value={essential.year_average} locale={locale} />
                </strong>
              </>
            }
          />
        </Flow>
      ) : null}

      {overdue.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-[var(--radius-s)] border border-[var(--color-bad)]/30 bg-[var(--color-bad)]/6 px-4 py-2.5">
          <Chip tone="bad">▲ {t(locale, 'inv.overdue')}</Chip>
          <span className="text-[12.5px]">
            {overdue.map((i) => `${i.reference_month.slice(0, 7)} · ${i.days_overdue}d`).join(' · ')}
          </span>
        </div>
      ) : null}

      <div className="mt-3">
        <Ledger rows={transactions} locale={locale} />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHead title={t(locale, 'cat.title')} note={<Money value={spent} locale={locale} />} />
          {data.categories.length > 0 ? (
            <BarList
              locale={locale}
              rows={data.categories.map((c) => ({
                label: c.name ?? t(locale, 'cat.uncategorized'),
                value: c.total,
                essential: c.is_essential,
                muted: c.name === null,
              }))}
            />
          ) : (
            <p className="text-[13px] text-[var(--color-muted)]">{t(locale, 'tx.empty')}</p>
          )}
          <Callout>{t(locale, 'cat.accrualNote')}</Callout>
        </Card>

        <Card>
          <CardHead title={t(locale, 'col.variance')} note={`${t(locale, 'col.actual')} / ${t(locale, 'col.target')}`} />
          {data.variance.length > 0 ? (
            <div className="flex flex-col gap-2">
              {data.variance.map((v) => (
                <div key={v.category_id} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
                    <span className="truncate">{v.name}</span>
                    {v.is_essential ? <Chip tone="essential">ESS</Chip> : null}
                  </span>
                  <span className="flex items-baseline gap-2.5">
                    <span className="tabular text-[11px] text-[var(--color-muted)]">
                      <Money value={v.actual} locale={locale} />
                      {v.monthly_target ? (
                        <>
                          {' / '}
                          <Money value={v.monthly_target} locale={locale} />
                        </>
                      ) : null}
                    </span>
                    {/* BR21: no target, no verdict — never invented from an average. */}
                    {v.variance === null ? (
                      <Chip tone="ghost">{t(locale, 'col.noTarget')}</Chip>
                    ) : (
                      <Chip tone={Number(v.variance) < 0 ? 'bad' : 'good'}>
                        {Number(v.variance) < 0 ? '▲' : '▼'}{' '}
                        <Money value={v.variance.replace('-', '')} locale={locale} />
                      </Chip>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[13px] text-[var(--color-muted)]">{t(locale, 'tx.empty')}</p>
          )}
          <Callout>{t(locale, 'plan.transferNote')}</Callout>
        </Card>

        <Card>
          <CardHead title={t(locale, 'inv.title')} note={<Money value={committed} locale={locale} />} />
          <div className="flex flex-col gap-2">
            {data.invoices.map((i) => (
              <div key={i.invoice_id} className="flex items-center justify-between gap-2 text-[12.5px]">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="code text-[11px] text-[var(--color-ink-2)]">
                    {i.reference_month.slice(0, 7)}
                  </span>
                  {i.is_overdue ? (
                    <Chip tone="bad">
                      ▲ {i.days_overdue}d {t(locale, 'inv.overdue')}
                    </Chip>
                  ) : (
                    <span className="truncate text-[11.5px] text-[var(--color-muted)]">
                      {t(locale, 'inv.due')} {i.due_on.slice(8, 10)}/{i.due_on.slice(5, 7)}
                    </span>
                  )}
                </span>
                <Money
                  value={i.open_amount}
                  locale={locale}
                  className="figure font-semibold text-[var(--color-ink-2)]"
                />
              </div>
            ))}
          </div>
          <Callout>{t(locale, 'inv.committedNote')}</Callout>
        </Card>
      </div>

      {data.debts.length > 0 ? (
        <div className="tile mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="label text-[var(--color-bad)]">{t(locale, 'debt.title')}</span>
          {data.debts.map((d) => (
            <span key={d.category_id ?? d.name} className="flex items-baseline gap-2 text-[12.5px]">
              <span className="text-[var(--color-ink-2)]">{d.name}</span>
              <Money
                value={d.total}
                locale={locale}
                className="figure font-semibold text-[var(--color-bad)]"
              />
            </span>
          ))}
          <span className="ml-auto max-w-[420px] text-[11px] leading-relaxed text-[var(--color-muted)]">
            {t(locale, 'debt.note')}
          </span>
        </div>
      ) : null}

      <div className="tile mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <span className="label">{t(locale, 'wallet.title')}</span>
        {data.wallets.map((w) => (
          <span key={w.category_id ?? w.name} className="flex items-baseline gap-2 text-[12.5px]">
            <span className="text-[var(--color-ink-2)]">{w.name}</span>
            <Money value={w.total} locale={locale} className="figure font-semibold" />
          </span>
        ))}
        <span className="ml-auto max-w-[420px] text-[11px] leading-relaxed text-[var(--color-muted)]">
          {t(locale, 'period.carriedNote')}
        </span>
      </div>
    </AppShell>
  );
}
