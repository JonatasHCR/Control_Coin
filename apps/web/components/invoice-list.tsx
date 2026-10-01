'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Chip } from '@/components/ui/card';
import { Money } from '@/components/ui/money';
import { PayInvoice } from '@/components/forms/pay-invoice';
import type { InvoiceRow } from '@/lib/api';

/** The invoice list plus its inline payment form. */
export function InvoiceList({
  invoices,
  accounts,
}: {
  invoices: InvoiceRow[];
  accounts: { id: string; name: string; balance: string }[];
}) {
  const router = useRouter();
  const [paying, setPaying] = useState<string | null>(null);

  if (invoices.length === 0) {
    return <p className="text-[13px] text-[var(--color-muted)]">Nenhuma fatura em aberto.</p>;
  }

  return (
    <div className="flex flex-col">
      {invoices.map((invoice) => (
        <div key={invoice.id} className="border-b border-[var(--color-line)] py-3 last:border-0">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[13px]">
              <span className="font-medium">{invoice.cardName}</span>
              <span className="tabular text-[var(--color-muted)]">
                {invoice.referenceMonth.slice(0, 7)}
              </span>
              {invoice.isOverdue ? (
                <Chip tone="bad">▲ {invoice.daysOverdue}d em atraso</Chip>
              ) : (
                <Chip>vence {invoice.dueOn.slice(8, 10)}/{invoice.dueOn.slice(5, 7)}</Chip>
              )}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-[13px] tabular text-[var(--color-ink-2)]">
                <Money value={invoice.openAmount} locale="pt-BR" />
              </span>
              <button
                type="button"
                onClick={() => setPaying(paying === invoice.id ? null : invoice.id)}
                className="rounded-md border border-[var(--color-rule)] px-2.5 py-1 text-[12px] font-semibold hover:bg-[var(--color-well)]"
              >
                {paying === invoice.id ? 'fechar' : 'pagar'}
              </button>
            </span>
          </div>

          {paying === invoice.id ? (
            <PayInvoice
              invoiceId={invoice.id}
              open={invoice.openAmount}
              accounts={accounts}
              onPaid={() => {
                setPaying(null);
                router.refresh(); // re-fetch the server component with the new state
              }}
            />
          ) : null}
        </div>
      ))}
    </div>
  );
}
