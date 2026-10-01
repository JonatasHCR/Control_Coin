import { AppShell } from '@/components/app-shell';
import { EditButton, EntityForm, NewButton } from '@/components/forms/entity-form';
import { DeleteButton } from '@/components/row-actions';
import { Meter } from '@/components/charts/meter';
import { Callout, Card, CardHead, Chip } from '@/components/ui/card';
import { PeriodNav } from '@/components/ui/period-nav';
import {
  apiFetch,
  type AccountTree,
  type BudgetRow,
  type CategoryRow,
  type GoalRow,
} from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

/** UC05 budgets, UC06 goals — the planning surface. Invoices live on
 *  their own screen; they are a different concern from what you plan to spend. */
export default async function PlanningPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const locale = await getLocale();
  const { period = new Date().toISOString().slice(0, 7) } = await searchParams;
  const [tree, budgets, goals, categories] = await Promise.all([
    apiFetch<AccountTree>('/accounts'),
    apiFetch<BudgetRow[]>(`/budgets?period=${period}`),
    apiFetch<GoalRow[]>('/goals'),
    apiFetch<CategoryRow[]>('/categories'),
  ]);

  const accounts = [...tree.wallets.flatMap((w) => w.accounts), ...tree.unassigned].map((a) => ({
    id: a.id,
    name: a.name,
    balance: a.balance,
  }));

  const categoryOptions = categories.map((c) => ({ value: c.id, label: c.name }));
  const walletOptions = tree.wallets.map((w) => ({ value: w.id, label: w.name }));
  const accountOptions = accounts.map((a) => ({ value: a.id, label: a.name }));
  const periodStart = `${period}-01`;

  return (
    <AppShell>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold">{t(locale, 'nav.planning')}</h1>
          <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{t(locale, 'plan.subtitle')}</p>
        </div>
        <PeriodNav period={period} basePath="/planning" locale={locale} />
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* UC05 — budgets */}
        <Card>
          <CardHead
            title={t(locale, 'budget.title')}
            action={
              <EntityForm
                trigger={<NewButton label="Orçamento" />}
                title="Novo orçamento"
                method="POST"
                path="budgets"
                submitLabel="Criar"
                fields={[
                  { name: 'categoryId', label: 'Categoria', type: 'select', options: categoryOptions },
                  { name: 'limitAmount', label: 'Limite', type: 'money', hint: 'Vazio herda a meta da categoria' },
                ]}
                extra={{ periodStart }}
              />
            }
          />
          {budgets.length > 0 ? (
            budgets.map((b) => (
              <Meter
                key={b.id}
                state={b.state === 'none' ? 'ok' : b.state}
                consumed={b.consumed}
                limit={b.limit}
                percent={b.percent}
                label={
                  <>
                    {b.name}
                    {b.isEssential ? <Chip tone="essential">ESS</Chip> : null}
                    {b.state === 'over' ? <Chip tone="bad">▲ {t(locale, 'budget.over')}</Chip> : null}
                    {b.inheritsTarget ? (
                      <span className="text-[11px] text-[var(--color-muted)]">
                        {t(locale, 'budget.fromTarget')}
                      </span>
                    ) : null}
                    <span className="ml-1 inline-flex items-center gap-1">
                      <EntityForm
                        trigger={<EditButton />}
                        title={`Editar ${b.name}`}
                        method="PATCH"
                        path={`budgets/${b.id}`}
                        submitLabel="Salvar"
                        fields={[
                          { name: 'limitAmount', label: 'Limite', type: 'money', value: b.limit ?? '', hint: 'Vazio herda a meta da categoria' },
                        ]}
                      />
                      <DeleteButton path={`budgets/${b.id}`} confirmLabel="Excluir este orçamento?" />
                    </span>
                  </>
                }
              />
            ))
          ) : (
            <p className="text-[13px] text-[var(--color-muted)]">{t(locale, 'budget.none')}</p>
          )}
          <Callout>{t(locale, 'budget.note')}</Callout>
        </Card>

        {/* UC06 — goals */}
        <Card>
          <CardHead
            title={t(locale, 'goal.title')}
            action={
              <EntityForm
                trigger={<NewButton label="Meta" />}
                title="Nova meta"
                method="POST"
                path="goals"
                submitLabel="Criar"
                fields={[
                  { name: 'name', label: 'Nome', type: 'text' },
                  { name: 'targetAmount', label: 'Valor alvo', type: 'money' },
                  { name: 'deadline', label: 'Prazo', type: 'date' },
                  {
                    name: 'sourceType',
                    label: 'Acompanha',
                    type: 'select',
                    options: [
                      { value: 'MANUAL', label: 'Aportes manuais' },
                      { value: 'WALLET', label: 'Saldo de uma carteira' },
                      { value: 'ACCOUNT', label: 'Saldo de uma conta' },
                    ],
                    hint: 'Um cartão nunca é fonte — guarda dívida',
                  },
                  { name: 'walletId', label: 'Carteira (se acompanha carteira)', type: 'select', options: [{ value: '', label: '—' }, ...walletOptions] },
                  { name: 'accountId', label: 'Conta (se acompanha conta)', type: 'select', options: [{ value: '', label: '—' }, ...accountOptions] },
                ]}
              />
            }
          />
          {goals.length > 0 ? (
            goals.map((g) => (
              <Meter
                key={g.id}
                state="goal"
                consumed={g.current}
                limit={g.target}
                percent={g.percent}
                note={`${t(locale, 'goal.needs')} ${g.monthlyNeeded}/${t(locale, 'goal.month')} · ${
                  g.sourceType === 'WALLET'
                    ? t(locale, 'goal.viaWallet')
                    : g.sourceType === 'ACCOUNT'
                      ? t(locale, 'goal.viaAccount')
                      : t(locale, 'goal.viaManual')
                }`}
                label={
                  <>
                    {g.name}
                    {g.complete ? <Chip tone="good">✓</Chip> : null}
                    <span className="ml-1 inline-flex items-center gap-1">
                      <EntityForm
                        trigger={<EditButton />}
                        title={`Editar ${g.name}`}
                        method="PATCH"
                        path={`goals/${g.id}`}
                        submitLabel="Salvar"
                        fields={[
                          { name: 'name', label: 'Nome', type: 'text', value: g.name },
                          { name: 'targetAmount', label: 'Valor alvo', type: 'money', value: g.target },
                          { name: 'deadline', label: 'Prazo', type: 'date', value: g.deadline.slice(0, 10) },
                        ]}
                      />
                      <DeleteButton path={`goals/${g.id}`} confirmLabel="Excluir esta meta?" />
                    </span>
                  </>
                }
              />
            ))
          ) : (
            <p className="text-[13px] text-[var(--color-muted)]">{t(locale, 'goal.none')}</p>
          )}
          <Callout>{t(locale, 'goal.note')}</Callout>
        </Card>
      </div>
    </AppShell>
  );
}
