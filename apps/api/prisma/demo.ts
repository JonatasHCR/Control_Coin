import { PrismaClient } from '@prisma/client';
import { money } from '@cc/domain/money';

import { SystemClock } from '../src/common/clock/clock.js';
import { TransactionsService } from '../src/modules/transactions/transactions.service.js';

/**
 * Demo data for accounts that have none — five of every transaction shape the
 * domain allows, one per month across five months, so each screen has variety
 * and the cost of living (BR14) has complete months to average.
 *
 * Unlike `seed.ts` this NEVER deletes: a user who already has transactions is
 * left exactly as they are, so running it cannot cost anyone their history.
 *
 *   npm run demo --workspace @cc/api -- erin teste
 */
const prisma = new PrismaClient();
const transactions = new TransactionsService(prisma, new SystemClock());

const MONTHS = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];

/** Amounts drift month to month so no chart comes out flat. */
const DRIFT = [1, 0.88, 1.12, 0.95, 1.06];

function amount(base: number, monthIndex: number): string {
  return (base * DRIFT[monthIndex]!).toFixed(2);
}

async function main(): Promise<void> {
  const names = process.argv.slice(2);
  if (names.length === 0) throw new Error('usage: demo <username> [username...]');

  for (const username of names) {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      console.log(JSON.stringify({ msg: 'demo.skip', username, why: 'no such user' }));
      continue;
    }

    const existing = await prisma.transaction.count({ where: { userId: user.id } });
    if (existing > 0) {
      console.log(JSON.stringify({ msg: 'demo.skip', username, why: 'already has data', existing }));
      continue;
    }

    await populate(user.id, username);
  }
}

async function populate(userId: string, username: string): Promise<void> {
  const wallet = await prisma.wallet.create({ data: { userId, name: 'Reserva' } });

  const main_ = await prisma.account.create({
    data: {
      userId, walletId: wallet.id, name: 'Banco',
      type: 'BANK', currency: 'BRL', initialBalance: '4200.00',
    },
  });

  // No wallet on purpose — BR16 makes it a report scope of its own.
  const cash = await prisma.account.create({
    data: { userId, name: 'Carteira', type: 'CASH', currency: 'BRL', initialBalance: '380.00' },
  });

  const both = await prisma.card.create({
    data: {
      accountId: main_.id, name: 'Principal',
      allowsCredit: true, allowsDebit: true,
      creditLimit: '5000.00', closingDay: 28, dueDay: 5,
    },
  });

  const creditOnly = await prisma.card.create({
    data: {
      accountId: main_.id, name: 'Compras',
      allowsCredit: true, allowsDebit: false,
      creditLimit: '2500.00', closingDay: 28, dueDay: 5,
    },
  });

  const [mercado, transporte, casa, lazer] = await Promise.all([
    prisma.category.create({
      data: { userId, name: 'Mercado', isEssential: true, monthlyTarget: '1200.00' },
    }),
    prisma.category.create({
      data: { userId, name: 'Transporte', isEssential: true, monthlyTarget: '450.00' },
    }),
    prisma.category.create({
      data: { userId, name: 'Casa', isEssential: true, monthlyTarget: '900.00' },
    }),
    prisma.category.create({
      data: { userId, name: 'Lazer', isEssential: false, monthlyTarget: '350.00' },
    }),
  ]);

  for (const [i, month] of MONTHS.entries()) {
    // 1 — income, straight into the account
    await transactions.create(userId, {
      kind: 'INCOME', occurrenceType: 'OCCASIONAL', categoryId: null,
      description: 'Salário', occurredOn: `${month}-05`,
      totalAmount: money(amount(6200, i)), currency: 'BRL',
      entries: [{ side: 'DESTINATION', accountId: main_.id, amount: money(amount(6200, i)) }],
    });

    // 2 — plain account expense
    await transactions.create(userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: mercado.id,
      description: 'Feira da semana', occurredOn: `${month}-08`,
      totalAmount: money(amount(420, i)), currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: main_.id, amount: money(amount(420, i)) }],
    });

    // 3 — debit card: settles against the account at once (BR07)
    await transactions.create(userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: transporte.id,
      description: 'Combustível', occurredOn: `${month}-11`,
      totalAmount: money(amount(260, i)), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: both.id, cardFunction: 'DEBIT', amount: money(amount(260, i)) }],
    });

    // 4 — credit in full: lands on the invoice, not the account
    await transactions.create(userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: lazer.id,
      description: 'Restaurante', occurredOn: `${month}-14`,
      totalAmount: money(amount(180, i)), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: creditOnly.id, cardFunction: 'CREDIT', amount: money(amount(180, i)) }],
    });

    // 5 — instalments: one entry, several settlements (BR10)
    await transactions.create(userId, {
      kind: 'EXPENSE', occurrenceType: 'INSTALLMENT', categoryId: casa.id,
      description: 'Eletrodoméstico', occurredOn: `${month}-16`,
      totalAmount: money(amount(900, i)), currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: both.id, cardFunction: 'CREDIT', amount: money(amount(900, i)), installmentCount: 6 },
      ],
    });

    // 6 — split across two cards, one of them in instalments (BR11, BR12)
    const half = amount(300, i);
    await transactions.create(userId, {
      kind: 'EXPENSE', occurrenceType: 'INSTALLMENT', categoryId: mercado.id,
      description: 'Compra grande', occurredOn: `${month}-18`,
      totalAmount: money((Number(half) * 2).toFixed(2)), currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: both.id, cardFunction: 'CREDIT', amount: money(half), installmentCount: 3 },
        { side: 'SOURCE', cardId: creditOnly.id, cardFunction: 'CREDIT', amount: money(half), installmentCount: 1 },
      ],
    });

    // 7 — recurring: the rent, with a frequency rather than a copy per month
    await transactions.create(userId, {
      kind: 'EXPENSE', occurrenceType: 'RECURRING', categoryId: casa.id,
      description: 'Aluguel', occurredOn: `${month}-10`,
      totalAmount: money('1650.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: main_.id, amount: money('1650.00') }],
      recurrence: { frequency: 'MONTHLY', intervalCount: 1, endsOn: null },
    });

    // 8 — uncategorized: shown, never dropped (BR01)
    await transactions.create(userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
      description: 'Diversos', occurredOn: `${month}-21`,
      totalAmount: money(amount(95, i)), currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: cash.id, amount: money(amount(95, i)) }],
    });

    // 9 — transfer: not spending, consumes no budget (BR03, BR14). BR31 keeps
    // credit off the source side, so this moves account to account.
    await transactions.create(userId, {
      kind: 'TRANSFER', occurrenceType: 'OCCASIONAL', categoryId: null,
      description: 'Para a carteira', occurredOn: `${month}-24`,
      totalAmount: money('200.00'), currency: 'BRL',
      entries: [
        { side: 'SOURCE', accountId: main_.id, amount: money('200.00') },
        { side: 'DESTINATION', accountId: cash.id, amount: money('200.00') },
      ],
    });
  }

  // A budget with an explicit limit and one that inherits its target (BR23).
  await prisma.budget.createMany({
    data: [
      { userId, categoryId: lazer.id, periodType: 'MONTHLY', periodStart: new Date('2026-09-01'), limitAmount: '350.00', currency: 'BRL' },
      { userId, categoryId: mercado.id, periodType: 'MONTHLY', periodStart: new Date('2026-09-01'), limitAmount: null, currency: 'BRL' },
    ],
  });

  await prisma.goal.create({
    data: {
      userId, name: 'Reserva de emergência', targetAmount: '20000.00',
      deadline: new Date('2027-06-30'), sourceType: 'WALLET', walletId: wallet.id,
    },
  });

  const count = await prisma.transaction.count({ where: { userId } });
  console.log(JSON.stringify({ msg: 'demo.done', username, transactions: count }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
