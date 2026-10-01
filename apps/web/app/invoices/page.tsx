import { AppShell } from '@/components/app-shell';
import { InvoiceList } from '@/components/invoice-list';
import { Callout, Card, CardHead } from '@/components/ui/card';
import { apiFetch, type AccountTree, type InvoiceRow } from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

/** UC12: card invoices and their payment — its own screen, separate from the
 *  planning surface (budgets and goals are a different concern). */
export default async function InvoicesPage() {
  const locale = await getLocale();
  const [invoices, tree] = await Promise.all([
    apiFetch<InvoiceRow[]>('/invoices'),
    apiFetch<AccountTree>('/accounts'),
  ]);

  const accounts = [...tree.wallets.flatMap((w) => w.accounts), ...tree.unassigned].map((a) => ({
    id: a.id,
    name: a.name,
    balance: a.balance,
  }));

  const open = invoices.filter((i) => Number(i.openAmount) > 0);
  const overdue = open.filter((i) => i.isOverdue);

  return (
    <AppShell>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold">{t(locale, 'nav.invoices')}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{t(locale, 'inv.subtitle')}</p>
      </header>

      {overdue.length > 0 ? (
        <div className="mb-4 rounded-[10px] border border-[var(--color-bad)]/30 bg-[var(--color-bad)]/6 px-4 py-3 text-[13px]">
          <strong>{t(locale, 'plan.overdueTitle')}</strong>{' '}
          {overdue.map((i) => `${i.cardName} · ${i.daysOverdue}d`).join(' · ')}
        </div>
      ) : null}

      <Card>
        <CardHead title={t(locale, 'inv.title')} note={`${open.length}`} />
        <InvoiceList invoices={open} accounts={accounts} />
        <Callout>{t(locale, 'plan.transferNote')}</Callout>
      </Card>
    </AppShell>
  );
}
