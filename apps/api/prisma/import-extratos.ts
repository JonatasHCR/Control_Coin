import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { money } from '@cc/domain/money';

import { SystemClock } from '../src/common/clock/clock.js';
import { TransactionsService } from '../src/modules/transactions/transactions.service.js';

/**
 * One-off import of the bank statements under `Extratos/` (UC09).
 *
 * Three deliberate exclusions, each of which would otherwise corrupt a report:
 *
 *  - **Cofrinho moves** are money shifted inside the same account. Counting
 *    them would add ~R$ 70k of churn to a net R$ 1.9k and wreck the cost of
 *    living (BR14).
 *  - **Invoice payments** are transfers, not spending (BR03). They need the
 *    invoice flow (UC12), not a row that looks like a purchase.
 *  - **Anything already recorded** on the same day for the same amount, so a
 *    manual entry is never duplicated by its statement line.
 *
 * Every row lands Uncategorized: a statement never says what a purchase was
 * for (BR01, BR26).
 *
 *   npm run import-extratos --workspace @cc/api -- <username> [--run]
 */
const prisma = new PrismaClient();
const transactions = new TransactionsService(prisma, new SystemClock());

const ROOT = join(process.cwd(), '..', '..', 'Extratos');

interface Movement {
  account: 'PicPay' | 'Nubank' | 'Salario';
  date: string;
  description: string;
  value: number;
}

function brl(raw: string): number {
  const text = raw.replace(/−/g, '-').replace('R$', '').trim();
  const negative = text.startsWith('-');
  const digits = text.replace(/^[+\-−]/, '').trim().replace(/\./g, '').replace(',', '.');
  if (digits === '') return 0;
  return Number((negative ? -1 : 1) * Number(digits));
}

/** A CSV line, honouring quoted fields. */
function splitCsv(line: string, sep: string): string[] {
  const out: string[] = [];
  let field = '';
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (ch === sep && !quoted) {
      out.push(field);
      field = '';
    } else field += ch;
  }
  out.push(field);
  return out;
}

function read(file: string): string[] {
  return readFileSync(join(ROOT, file), 'utf8').replace(/^﻿/, '').split(/\r?\n/);
}

function collect(): Movement[] {
  const files = readdirSync(ROOT);
  const movements: Movement[] = [];

  for (const file of files.filter((f) => f.startsWith('extrato-'))) {
    const [, ...lines] = read(file);
    for (const line of lines) {
      const [date, , kind, who, value] = splitCsv(line, ',');
      if (!date || !value) continue;
      if ((who ?? '').toLowerCase().includes('cofrinho')) continue;
      movements.push({
        account: 'PicPay',
        date,
        description: `${kind} — ${who}`.slice(0, 180),
        value: brl(value),
      });
    }
  }

  for (const file of files.filter((f) => f.startsWith('NU_'))) {
    const [, ...lines] = read(file);
    for (const line of lines) {
      const [date, value, , description] = splitCsv(line, ',');
      if (!date || !value) continue;
      movements.push({
        account: 'Nubank',
        date: `${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}`,
        description: (description ?? '').split(' - •')[0]!.slice(0, 180),
        value: Number(value),
      });
    }
  }

  for (const file of files.filter((f) => f.startsWith('9'))) {
    for (const line of read(file).slice(2)) {
      const parts = splitCsv(line, ';');
      if (parts.length < 6 || !parts[0]?.includes('/')) continue;
      const value = (brl(parts[3] ?? '') || 0) - Math.abs(brl(parts[4] ?? '') || 0);
      if (value === 0) continue;
      const date = parts[0];
      movements.push({
        account: 'Salario',
        date: `${date.slice(6, 10)}-${date.slice(3, 5)}-${date.slice(0, 2)}`,
        description: (parts[1] ?? '').trim().slice(0, 180),
        value: Number(value.toFixed(2)),
      });
    }
  }

  return movements.filter((m) => m.value !== 0);
}

const INVOICE_PAYMENT = /PAGAMENTO DE FATURA|BANCO IBI|BRADESCARD/i;

async function main(): Promise<void> {
  const [username] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const run = process.argv.includes('--run');
  if (!username) throw new Error('usage: import-extratos <username> [--run]');

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`no such user: ${username}`);

  const accounts = await prisma.account.findMany({
    where: { userId: user.id },
    include: { wallet: true },
  });
  const find = (name: string, wallet: string) =>
    accounts.find((a) => a.name === name && a.wallet?.name === wallet);

  const picpay = find('PicPay', 'Jonatas');
  const nubank = find('Nubank', 'Jonatas');
  if (!picpay || !nubank) throw new Error('expected Jonatas › PicPay and Jonatas › Nubank');

  let salario = accounts.find((a) => a.name === 'Salário');
  if (!salario) {
    salario = await prisma.account.create({
      data: {
        userId: user.id,
        walletId: picpay.walletId,
        name: 'Salário',
        type: 'BANK',
        currency: 'BRL',
        initialBalance: '0.00',
      },
      include: { wallet: true },
    });
    console.log(JSON.stringify({ msg: 'account.created', name: 'Salário' }));
  }

  const target = { PicPay: picpay.id, Nubank: nubank.id, Salario: salario.id };

  // Never duplicate something already recorded by hand on the same day.
  const existing = await prisma.transaction.findMany({
    where: { userId: user.id },
    select: { occurredOn: true, totalAmount: true },
  });
  const already = new Set(
    existing.map((t) => `${t.occurredOn.toISOString().slice(0, 10)}|${t.totalAmount.toFixed(2)}`),
  );

  const movements = collect();
  const skippedInvoice: Movement[] = [];
  const skippedDuplicate: Movement[] = [];
  const queue: Movement[] = [];

  for (const m of movements) {
    if (INVOICE_PAYMENT.test(m.description)) skippedInvoice.push(m);
    else if (already.has(`${m.date}|${Math.abs(m.value).toFixed(2)}`)) skippedDuplicate.push(m);
    else queue.push(m);
  }

  console.log(
    JSON.stringify({
      msg: 'import.plan',
      toImport: queue.length,
      skippedInvoicePayments: skippedInvoice.length,
      skippedAlreadyRecorded: skippedDuplicate.length,
    }),
  );

  if (!run) {
    console.log('dry run — pass --run to write');
    return;
  }

  let written = 0;
  let failed = 0;
  for (const m of queue) {
    const amount = money(Math.abs(m.value).toFixed(2));
    const income = m.value > 0;
    try {
      await transactions.create(user.id, {
        kind: income ? 'INCOME' : 'EXPENSE',
        occurrenceType: 'OCCASIONAL',
        categoryId: null, // BR01 — a statement does not say what it was for
        description: m.description,
        occurredOn: m.date,
        totalAmount: amount,
        currency: 'BRL',
        entries: [
          {
            side: income ? 'DESTINATION' : 'SOURCE',
            accountId: target[m.account],
            amount,
          },
        ],
      });
      written += 1;
    } catch (error) {
      failed += 1;
      console.error(JSON.stringify({ msg: 'import.failed', date: m.date, value: m.value, error: String(error).slice(0, 160) }));
    }
  }

  console.log(JSON.stringify({ msg: 'import.done', written, failed }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
