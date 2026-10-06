import { AppShell } from '@/components/app-shell';
import type { Source } from '@/components/forms/transaction-form';
import { PlannedBoard, type Planned } from '@/components/planned-board';
import { Callout } from '@/components/ui/card';
import { apiFetch } from '@/lib/api';

/** UC13: what may happen, and the confirmation of what did (BR40). */
export default async function PlannedPage({ searchParams }: { searchParams: Promise<{ confirm?: string }> }) {
  const { confirm } = await searchParams;
  const [planned, options] = await Promise.all([
    apiFetch<{ pending: Planned[]; resolved: Planned[] }>('/planned'),
    apiFetch<{ sources: Source[]; categories: { id: string; name: string }[] }>('/transactions/options'),
  ]);

  return (
    <AppShell>
      <header className="mb-4">
        <h1 className="text-[22px] font-semibold">Previstos</h1>
        <p className="mt-0.5 text-[13px] text-[var(--color-muted)]">
          Despesas, receitas e transferências que podem acontecer. Perto da data o sino pergunta o que aconteceu.
        </p>
      </header>
      <PlannedBoard pending={planned.pending} resolved={planned.resolved} sources={options.sources} categories={options.categories} openId={confirm} />
      <Callout>Um previsto não mexe em saldo, fatura nem relatório até você confirmar — ele pode não acontecer.</Callout>
    </AppShell>
  );
}
