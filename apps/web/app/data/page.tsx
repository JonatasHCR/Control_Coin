import { AppShell } from '@/components/app-shell';
import { ImportCsv } from '@/components/forms/import-csv';
import { ImportWorkbook } from '@/components/forms/import-workbook';
import { RestoreBackup } from '@/components/forms/restore-backup';
import { Callout, Card, CardHead } from '@/components/ui/card';
import { apiFetch, type AccountTree } from '@/lib/api';
import { t } from '@/lib/i18n';
import { getLocale } from '@/lib/prefs';

/** UC09: import a statement, export data. CSV — the safe common denominator. */
export default async function DataPage() {
  const locale = await getLocale();
  const tree = await apiFetch<AccountTree>('/accounts');
  const accounts = [...tree.wallets.flatMap((w) => w.accounts), ...tree.unassigned].map((a) => ({
    id: a.id,
    name: a.name,
  }));

  return (
    <AppShell>
      <header className="mb-6">
        <h1 className="text-[22px] font-semibold">{t(locale, 'nav.data')}</h1>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">{t(locale, 'data.subtitle')}</p>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHead title="Planilha para preencher" note="XLSX" />
          <ImportWorkbook />
        </Card>

        <Card>
          <CardHead title={t(locale, 'data.import')} note="CSV" />
          <ImportCsv accounts={accounts} />
          <Callout>{t(locale, 'data.importNote')}</Callout>
        </Card>

        <Card>
          <CardHead title={t(locale, 'data.export')} />
          <p className="mb-4 text-[13px] text-[var(--color-ink-2)]">{t(locale, 'data.exportIntro')}</p>
          <div className="flex flex-col gap-2.5">
            <a
              href="/api/data/export?level=transaction"
              className="flex items-center justify-between rounded-[10px] border border-[var(--color-line)] px-3.5 py-3 text-[13px] transition hover:bg-[var(--color-well)]"
            >
              <span>
                <strong>{t(locale, 'data.txLevel')}</strong>
                <span className="ml-2 text-[var(--color-muted)]">{t(locale, 'data.txLevelNote')}</span>
              </span>
              <span className="font-semibold text-[var(--color-accent)]">↓ CSV</span>
            </a>
            <a
              href="/api/data/export?level=settlement"
              className="flex items-center justify-between rounded-[10px] border border-[var(--color-line)] px-3.5 py-3 text-[13px] transition hover:bg-[var(--color-well)]"
            >
              <span>
                <strong>{t(locale, 'data.settleLevel')}</strong>
                <span className="ml-2 text-[var(--color-muted)]">
                  {t(locale, 'data.settleLevelNote')}
                </span>
              </span>
              <span className="font-semibold text-[var(--color-accent)]">↓ CSV</span>
            </a>
            {/* BR26: Excel carries both levels in one workbook, five sheets. */}
            <a
              href="/api/data/export-xlsx"
              className="flex items-center justify-between rounded-[10px] border border-[var(--color-accent)] bg-[var(--color-accent-soft)] px-3.5 py-3 text-[13px] transition hover:brightness-105"
            >
              <span>
                <strong>{t(locale, 'data.workbook')}</strong>
                <span className="ml-2 text-[var(--color-ink-2)]">{t(locale, 'data.workbookNote')}</span>
              </span>
              <span className="font-semibold text-[var(--color-accent)]">↓ XLSX</span>
            </a>
            <form
              action="/api/reports/summary-pdf"
              method="get"
              className="flex items-center justify-between gap-3 rounded-[10px] border border-[var(--color-line)] px-3.5 py-2.5 text-[13px]"
            >
              <span>
                <strong>Resumo financeiro</strong>
                <span className="ml-2 text-[var(--color-muted)]">saldos, despesas por categoria, faturas</span>
              </span>
              <span className="flex items-center gap-2">
                <input
                  type="month"
                  name="period"
                  defaultValue={new Date().toISOString().slice(0, 7)}
                  className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1 text-[12px]"
                />
                <button type="submit" className="font-semibold text-[var(--color-accent)]">↓ PDF</button>
              </span>
            </form>
            <form
              action="/api/reports/summary-pdf"
              method="get"
              className="flex flex-wrap items-center justify-between gap-3 rounded-[10px] border border-[var(--color-line)] px-3.5 py-2.5 text-[13px]"
            >
              <span>
                <strong>Resumo por período</strong>
                <span className="ml-2 text-[var(--color-muted)]">de uma data a outra</span>
              </span>
              <span className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-muted)]">
                de
                <input
                  type="date"
                  name="from"
                  required
                  defaultValue={`${new Date().getFullYear()}-01-01`}
                  className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1 text-[12px] text-[var(--color-ink)]"
                />
                até
                <input
                  type="date"
                  name="to"
                  required
                  defaultValue={new Date().toISOString().slice(0, 10)}
                  className="rounded-md border border-[var(--color-rule)] bg-[var(--color-surface)] px-2 py-1 text-[12px] text-[var(--color-ink)]"
                />
                <button type="submit" className="text-[13px] font-semibold text-[var(--color-accent)]">↓ PDF</button>
              </span>
            </form>
          </div>
          <Callout>{t(locale, 'data.exportNote')}</Callout>
        </Card>

        <Card>
          <CardHead title="Backup completo" note="JSON" />
          <RestoreBackup />
        </Card>
      </div>
    </AppShell>
  );
}
