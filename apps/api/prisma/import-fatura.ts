import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { money } from '@cc/domain/money';

import { SystemClock } from '../src/common/clock/clock.js';
import { TransactionsService } from '../src/modules/transactions/transactions.service.js';

/**
 * The Nubank card invoices (UC09) — the spending behind the payments that were
 * already in the account statement.
 *
 * Instalments are rebuilt as ONE purchase split N ways (BR10), not as N loose
 * charges: seeing "Parcela 14/24" on a January invoice says the purchase
 * happened thirteen cycles earlier, so the original date is recoverable even
 * though it sits outside the files. The total is the modal instalment times N
 * plus the odd cents the card puts on the first part — a formula that
 * reproduces the two plans already entered by hand (Alura 24×93,00 = 2.232,00
 * and Shopee 12×197,90+0,10 = 2.374,90), which is what makes it trustworthy.
 *
 *   npm run import-fatura --workspace @cc/api -- <username> [--run]
 */
const prisma = new PrismaClient();
const transactions = new TransactionsService(prisma, new SystemClock());
const ROOT = join(process.cwd(), '..', '..', 'Extratos');

/** Already entered by hand — importing them again would double the plan. */
const ALREADY_ENTERED = [/^Alura/i, /^Shopee \*Cbocomercial/i];

interface Line {
  invoice: string;
  date: string;
  title: string;
  value: number;
  instalment: { index: number; of: number } | null;
}

function brl(raw: string): number {
  const text = raw.replace(/−/g, '-').replace(/\s/g, '');
  const negative = text.startsWith('-');
  const digits = text.replace(/^-/, '').replace(/\./g, '').replace(',', '.');
  return Number(((negative ? -1 : 1) * Number(digits)).toFixed(2));
}

function splitCsv(line: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

/** Shift an ISO date back by whole months, clamped to the target month. */
function monthsBefore(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const base = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), Math.min(d, last)))
    .toISOString()
    .slice(0, 10);
}

function read(): { lines: Line[]; payments: { invoice: string; date: string; amount: number }[] } {
  const lines: Line[] = [];
  const payments: { invoice: string; date: string; amount: number }[] = [];

  for (const file of readdirSync(ROOT).filter((f) => f.startsWith('Nubank_')).sort()) {
    const invoice = file.slice(7, 14); // YYYY-MM from the due date in the name
    const [, ...rows] = readFileSync(join(ROOT, file), 'utf8').replace(/^﻿/, '').split(/\r?\n/);
    for (const row of rows) {
      const [date, title, amount] = splitCsv(row);
      if (!date || !title || !amount) continue;
      const value = brl(amount);
      if (/pagamento recebido/i.test(title)) {
        payments.push({ invoice, date, amount: Math.abs(value) });
        continue;
      }
      const m = /^(.*) - Parcela (\d+)\/(\d+)$/.exec(title);
      lines.push({
        invoice,
        date,
        title: m ? m[1]!.trim() : title.trim(),
        value,
        instalment: m ? { index: Number(m[2]), of: Number(m[3]) } : null,
      });
    }
  }
  return { lines, payments };
}

async function main(): Promise<void> {
  const [username] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const run = process.argv.includes('--run');
  if (!username) throw new Error('usage: import-fatura <username> [--run]');

  const user = await prisma.user.findUniqueOrThrow({ where: { username } });
  const card = await prisma.card.findFirstOrThrow({
    where: { account: { userId: user.id }, name: 'credito principal' },
  });
  const nubank = await prisma.account.findFirstOrThrow({
    where: { userId: user.id, name: 'Nubank', wallet: { name: 'Jonatas' } },
  });

  const { lines, payments } = read();
  // A refund (a cancelled ride, an "Estorno de …") is a credit on the card:
  // it lowers what the invoice owes exactly as a payment does, which is how
  // v_invoice_total already reads a DESTINATION entry on a card.
  const oneOff = lines.filter((l) => !l.instalment && l.value > 0);
  const refunds = lines.filter((l) => !l.instalment && l.value < 0);

  // Group the instalment lines into their original purchases.
  const groups = new Map<string, Line[]>();
  for (const l of lines) {
    if (!l.instalment) continue;
    if (ALREADY_ENTERED.some((re) => re.test(l.title))) continue;
    const key = `${l.title}|${l.instalment.of}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }

  /*
   * A shop can sell you two things in 3x. Name and count alone would fuse
   * them, and pairing by posting date fails when the two plans interleave —
   * but the instalments of ONE purchase all carry the same value, give or take
   * the cent the card puts on the first part. So the clusters are by value.
   */
  const plans = [...groups.entries()].flatMap(([key, parts]) => {
    const of = parts[0]!.instalment!.of;
    const sorted = [...parts].sort((a, b) => a.value - b.value);

    const clusters: Line[][] = [];
    for (const part of sorted) {
      const last = clusters[clusters.length - 1];
      if (last && Math.abs(part.value - last[0]!.value) <= 0.02) last.push(part);
      else clusters.push([part]);
    }

    return clusters.map((cluster, slot) => {
      const byIndex = [...cluster].sort((a, b) => a.instalment!.index - b.instalment!.index);
      const first = byIndex[0]!;

      const counts = new Map<number, number>();
      for (const c of cluster) counts.set(c.value, (counts.get(c.value) ?? 0) + 1);
      const modal = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]![0];
      const extra = [...counts.entries()]
        .filter(([v]) => v !== modal)
        .reduce((sum, [v, n]) => sum + (v - modal) * n, 0);

      return {
        title: first.title,
        of,
        total: Number((modal * of + extra).toFixed(2)),
        // Parcela 1 carries the real purchase date; a later one is a posting date.
        occurredOn: monthsBefore(first.date, first.instalment!.index - 1),
        seen: cluster.length,
        key: `${key}#${slot}`,
      };
    });
  });

  console.log(
    JSON.stringify({
      msg: 'fatura.plan',
      oneOffPurchases: oneOff.length,
      refunds: refunds.length,
      instalmentPlans: plans.length,
      instalmentLinesCovered: plans.reduce((n, p) => n + p.seen, 0),
      invoicePayments: payments.length,
      purchasesTotal: Number(oneOff.reduce((s, l) => s + l.value, 0).toFixed(2)),
      refundsTotal: Number(refunds.reduce((s, l) => s + Math.abs(l.value), 0).toFixed(2)),
      plansTotal: Number(plans.reduce((s, p) => s + p.total, 0).toFixed(2)),
      paymentsTotal: Number(payments.reduce((s, p) => s + p.amount, 0).toFixed(2)),
    }),
  );

  if (!run) {
    console.log('\nplanos de parcelamento reconstruidos:');
    for (const p of plans.sort((a, b) => a.occurredOn.localeCompare(b.occurredOn))) {
      console.log(
        `  ${p.occurredOn}  ${p.title.slice(0, 34).padEnd(34)} ${String(p.of).padStart(2)}x  total R$ ${p.total.toFixed(2).padStart(9)}  (vistas ${p.seen})`,
      );
    }
    console.log('\ndry run — pass --run to write');
    return;
  }

  let written = 0;
  for (const l of oneOff) {
    const amount = money(l.value.toFixed(2));
    await transactions.create(user.id, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      description: l.title.slice(0, 180),
      occurredOn: l.date,
      totalAmount: amount,
      currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: card.id, cardFunction: 'CREDIT', amount }],
    });
    written += 1;
  }

  for (const l of refunds) {
    const amount = money(Math.abs(l.value).toFixed(2));
    await transactions.create(user.id, {
      kind: 'INCOME',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      description: l.title.slice(0, 180),
      occurredOn: l.date,
      totalAmount: amount,
      currency: 'BRL',
      entries: [{ side: 'DESTINATION', cardId: card.id, cardFunction: 'CREDIT', amount }],
    });
    written += 1;
  }

  for (const p of plans) {
    const amount = money(p.total.toFixed(2));
    await transactions.create(user.id, {
      kind: 'EXPENSE',
      occurrenceType: 'INSTALLMENT',
      categoryId: null,
      description: p.title.slice(0, 180),
      occurredOn: p.occurredOn,
      totalAmount: amount,
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: card.id, cardFunction: 'CREDIT', amount, installmentCount: p.of },
      ],
    });
    written += 1;
  }

  console.log(JSON.stringify({ msg: 'fatura.done', written, nubankAccount: nubank.name }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
