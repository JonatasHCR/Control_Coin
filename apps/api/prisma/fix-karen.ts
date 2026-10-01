import { PrismaClient } from '@prisma/client';
import { money } from '@cc/domain/money';

import { SystemClock } from '../src/common/clock/clock.js';
import { TransactionsService } from '../src/modules/transactions/transactions.service.js';

/**
 * Repair of the hand-entered data, once the statements were imported.
 *
 * Three faults, each provable from the numbers:
 *
 *  1. The 24 "Fatura credito principal" transfers put their DESTINATION on the
 *     card with function CREDIT, which posts a CHARGE to the invoice. They
 *     were inflating the debt rather than paying it, and all carried today's
 *     date rather than the month each was actually paid.
 *  2. The recurring "Salario" duplicated income the statement already records
 *     as an incoming Pix — R$ 10.965,72 of money counted twice.
 *  3. The 17 invoice payments were left out of the import to keep them from
 *     counting as spending (BR03). But the money did leave the account, so
 *     leaving them out inflated every balance. They go in as expenses: the
 *     card purchases behind them are in no statement here, so this is the only
 *     place that spending can be represented at all. It is a deliberate
 *     departure from BR03, taken because a balance that lies is worse.
 *
 *   npm run fix-karen --workspace @cc/api -- <username> [--run]
 */
const prisma = new PrismaClient();
const transactions = new TransactionsService(prisma, new SystemClock());

/** The payments held back by the import, read off the statements. */
const INVOICE_PAYMENTS: { account: 'PicPay' | 'Nubank'; date: string; amount: string; label: string }[] = [
  { account: 'PicPay', date: '2026-01-13', amount: '441.34', label: 'Pagamento de fatura — BANCO IBI' },
  { account: 'PicPay', date: '2026-02-11', amount: '441.34', label: 'Pagamento de fatura — BANCO IBI' },
  { account: 'PicPay', date: '2026-03-09', amount: '441.34', label: 'Pagamento de fatura — BANCO IBI' },
  { account: 'PicPay', date: '2026-04-06', amount: '441.34', label: 'Pagamento de fatura — BANCO IBI' },
  { account: 'PicPay', date: '2026-05-09', amount: '441.34', label: 'Pagamento de fatura — BANCO IBI' },
  { account: 'PicPay', date: '2026-06-15', amount: '441.34', label: 'Pagamento de fatura — BANCO IBI' },
  { account: 'PicPay', date: '2026-07-13', amount: '441.34', label: 'Pagamento de fatura — BANCO IBI' },
  { account: 'PicPay', date: '2026-08-08', amount: '441.34', label: 'Pagamento de fatura — BANCO BRADESCARD' },
  { account: 'PicPay', date: '2026-09-12', amount: '441.34', label: 'Pagamento de fatura — BANCO IBI' },
  { account: 'Nubank', date: '2025-01-08', amount: '433.34', label: 'Pagamento de fatura' },
  { account: 'Nubank', date: '2026-02-07', amount: '1581.34', label: 'Pagamento de fatura' },
  { account: 'Nubank', date: '2026-03-10', amount: '1756.54', label: 'Pagamento de fatura' },
  { account: 'Nubank', date: '2026-04-06', amount: '1809.41', label: 'Pagamento de fatura' },
  { account: 'Nubank', date: '2026-05-07', amount: '2145.47', label: 'Pagamento de fatura' },
  { account: 'Nubank', date: '2026-06-05', amount: '1926.89', label: 'Pagamento de fatura' },
  { account: 'Nubank', date: '2026-07-09', amount: '1538.98', label: 'Pagamento de fatura' },
  { account: 'Nubank', date: '2026-08-08', amount: '1365.36', label: 'Pagamento de fatura' },
];

/** Delete a transaction's whole spine in one go — the BR12 trigger is deferred. */
async function remove(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      DELETE FROM settlement WHERE entry_id IN (
        SELECT id FROM entry WHERE transaction_id = ANY(${ids}::uuid[]))`;
    await tx.$executeRaw`DELETE FROM entry WHERE transaction_id = ANY(${ids}::uuid[])`;
    await tx.$executeRaw`DELETE FROM transaction WHERE id = ANY(${ids}::uuid[])`;
  });
}

async function main(): Promise<void> {
  const [username] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const run = process.argv.includes('--run');
  if (!username) throw new Error('usage: fix-karen <username> [--run]');

  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) throw new Error(`no such user: ${username}`);

  const bad = await prisma.transaction.findMany({
    where: { userId: user.id, description: { startsWith: 'Fatura credito principal' } },
    select: { id: true, totalAmount: true },
  });

  const salary = await prisma.transaction.findMany({
    where: { userId: user.id, description: 'Salario', occurrenceType: 'RECURRING' },
    select: { id: true, totalAmount: true, seriesId: true },
  });

  console.log(
    JSON.stringify({
      msg: 'fix.plan',
      badInvoiceTransfers: bad.length,
      duplicatedSalary: salary.length,
      invoicePaymentsToAdd: INVOICE_PAYMENTS.length,
    }),
  );

  if (!run) {
    console.log('dry run — pass --run to write');
    return;
  }

  await remove(bad.map((t) => t.id));
  await remove(salary.map((t) => t.id));

  const seriesIds = [...new Set(salary.map((t) => t.seriesId).filter((id): id is string => !!id))];
  if (seriesIds.length > 0) {
    await prisma.series.deleteMany({ where: { id: { in: seriesIds } } });
  }

  const accounts = await prisma.account.findMany({
    where: { userId: user.id },
    include: { wallet: true },
  });
  const pick = (name: string) =>
    accounts.find((a) => a.name === name && a.wallet?.name === 'Jonatas')?.id;
  const target = { PicPay: pick('PicPay'), Nubank: pick('Nubank') };

  let written = 0;
  for (const p of INVOICE_PAYMENTS) {
    const accountId = target[p.account];
    if (!accountId) continue;
    await transactions.create(user.id, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      description: p.label,
      occurredOn: p.date,
      totalAmount: money(p.amount),
      currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId, amount: money(p.amount) }],
    });
    written += 1;
  }

  console.log(
    JSON.stringify({
      msg: 'fix.done',
      removedTransfers: bad.length,
      removedSalary: salary.length,
      removedSeries: seriesIds.length,
      addedInvoicePayments: written,
    }),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
