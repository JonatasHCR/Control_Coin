import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import {
  TransactionForm,
  type FormState,
  type Part,
  type Source,
  type TransactionInitial,
} from '@/components/forms/transaction-form';
import { Card, CardHead, Callout } from '@/components/ui/card';
import { ApiError, apiFetch, type FullTransaction } from '@/lib/api';
import { displayMoney } from '@/lib/money-input';

interface Options {
  sources: Source[];
  categories: { id: string; name: string }[];
}

/** UC03: editing amounts or sources is a full replace (PUT), because the
 *  entries and their settlements are re-checked as a unit by BR12. */
export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [tx, options] = await Promise.all([
    apiFetch<FullTransaction>(`/transactions/${id}`),
    apiFetch<Options>('/transactions/options'),
  ]);

  const toPart = (e: FullTransaction['entries'][number]): Part => ({
    sourceId: e.cardId ?? e.accountId ?? '',
    cardFunction: e.cardFunction ?? '',
    amount: displayMoney(e.amount),
    installmentCount: e.installmentCount,
  });

  const initial: TransactionInitial = {
    kind: tx.kind,
    description: tx.description ?? '',
    occurredOn: tx.occurredOn.slice(0, 10),
    categoryId: tx.categoryId ?? '',
    total: displayMoney(tx.totalAmount),
    recurring: tx.occurrenceType === 'RECURRING',
    frequency: tx.series?.frequency ?? 'MONTHLY',
    intervalCount: tx.series?.intervalCount ?? 1,
    endsOn: tx.series?.endsOn ? tx.series.endsOn.slice(0, 10) : '',
    sourceParts: tx.entries.filter((e) => e.side === 'SOURCE').map(toPart),
    destParts: tx.entries.filter((e) => e.side === 'DESTINATION').map(toPart),
  };

  async function replace(_state: FormState, formData: FormData): Promise<FormState> {
    'use server';

    const body = String(formData.get('payload') ?? '{}');
    try {
      // A full replace: the API deletes the old spine and writes the new one in
      // one database transaction, so BR12's deferred trigger sees a balanced
      // result at COMMIT (never a half-edited state).
      await apiFetch(`/transactions/${id}`, { method: 'PUT', body });
    } catch (error) {
      const code = error instanceof ApiError ? error.code : 'INTERNAL';
      return { error: `Não foi possível salvar (${code}).` };
    }

    revalidatePath('/');
    revalidatePath('/transactions');
    redirect('/transactions'); // NEXT_REDIRECT is thrown here, outside the try
  }

  return (
    <AppShell>
      <h1 className="mb-5 text-xl font-bold tracking-tight">Editar lançamento</h1>

      <div className="max-w-[640px]">
        <Card>
          <CardHead title="Despesa, receita ou transferência" />
          <TransactionForm
            sources={options.sources}
            categories={options.categories}
            action={replace}
            initial={initial}
            submitLabel="Salvar alterações"
          />
          <Callout>
            Editar valores ou fontes recria o lançamento por inteiro — o saldo, a fatura e o
            orçamento se ajustam sozinhos, porque tudo é derivado das liquidações.
          </Callout>
        </Card>
      </div>
    </AppShell>
  );
}
