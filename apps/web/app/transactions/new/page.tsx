import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { AppShell } from '@/components/app-shell';
import { TransactionForm, type FormState, type Source } from '@/components/forms/transaction-form';
import { Card, CardHead, Callout } from '@/components/ui/card';
import { ApiError, apiFetch } from '@/lib/api';

interface Options {
  sources: Source[];
  categories: { id: string; name: string }[];
}

/** UC03: kind, occurrence and source are three independent controls. */
export default async function NewTransactionPage() {
  const options = await apiFetch<Options>('/transactions/options');

  async function create(_state: FormState, formData: FormData): Promise<FormState> {
    'use server';

    // The client component built the whole body — kind, occurrence, entries and
    // recurrence — so it arrives as one JSON field. The API is the authority and
    // re-checks every rule; this only forwards it and reports refusals
    // back to the form rather than crashing to an error page.
    const body = String(formData.get('payload') ?? '{}');

    try {
      await apiFetch('/transactions', { method: 'POST', body });
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
      <h1 className="mb-5 text-xl font-bold tracking-tight">Novo lançamento</h1>

      <div className="max-w-[640px]">
        <Card>
          <CardHead title="Despesa, receita ou transferência" />
          <TransactionForm
            sources={options.sources}
            categories={options.categories}
            action={create}
          />
          <Callout>
            As partes precisam somar exatamente o total. A mesma regra é verificada aqui,
            no schema da API e por um <em>trigger</em> adiado no banco — três defesas, uma
            implementação.
          </Callout>
        </Card>
      </div>
    </AppShell>
  );
}
