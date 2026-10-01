import { PrismaClient } from '@prisma/client';

import { FixedClock } from '../src/common/clock/clock.js';
import { TransactionsService } from '../src/modules/transactions/transactions.service.js';

/**
 * Integration harness: a real PostgreSQL, never a mock (ARCH02).
 *
 * The deferred trigger for BR12, the credit/invoice rule for BR07 and the
 * function check for BR09 all live in the database. A mock would happily accept
 * every write they exist to reject, so a test against one proves nothing.
 */
export const prisma = new PrismaClient();

/** 24 July 2026 — the date the docs and the prototype are written around. */
export const TODAY = '2026-07-24';
export const clock = new FixedClock(TODAY);
export const transactions = new TransactionsService(prisma, clock);

export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE settlement, entry, invoice, transaction, series, import_batch,
             goal_contribution, goal, budget, notification, alert_rule,
             category, card, account, wallet, recovery_code, session,
             audit_event, backup_run, login_attempt, job_run, app_user
    RESTART IDENTITY CASCADE`);
}

export interface Fixture {
  userId: string;
  walletId: string;
  nubankId: string;
  itauId: string;
  buyCardId: string;
  foodCardId: string;
  foodCategoryId: string;
}

/**
 * The world the use cases describe: an Emergency wallet holding a Nubank
 * account, which issues Food (credit) and Buy (credit + debit) — plus an Itaú
 * account so an invoice can be paid from two places (UC10, UC12).
 */
export async function seed(): Promise<Fixture> {
  const user = await prisma.user.create({
    data: { username: 'jonatas', passwordHash: 'x', mainCurrency: 'BRL' },
  });

  const wallet = await prisma.wallet.create({
    data: { userId: user.id, name: 'Emergency' },
  });

  const nubank = await prisma.account.create({
    data: {
      userId: user.id,
      walletId: wallet.id,
      name: 'Nubank',
      type: 'BANK',
      currency: 'BRL',
      initialBalance: '10000.00',
    },
  });

  const itau = await prisma.account.create({
    data: {
      userId: user.id,
      name: 'Itaú',
      type: 'BANK',
      currency: 'BRL',
      initialBalance: '5000.00',
    },
  });

  const buy = await prisma.card.create({
    data: {
      accountId: nubank.id,
      name: 'Buy',
      allowsCredit: true,
      allowsDebit: true, // the combo card
      creditLimit: '4000.00',
      closingDay: 28,
      dueDay: 5,
    },
  });

  const food = await prisma.card.create({
    data: {
      accountId: nubank.id,
      name: 'Food',
      allowsCredit: true,
      allowsDebit: false, // credit only — used to prove BR09
      creditLimit: '2000.00',
      closingDay: 28,
      dueDay: 5,
    },
  });

  const category = await prisma.category.create({
    data: { userId: user.id, name: 'Food', isEssential: true, monthlyTarget: '1400.00' },
  });

  return {
    userId: user.id,
    walletId: wallet.id,
    nubankId: nubank.id,
    itauId: itau.id,
    buyCardId: buy.id,
    foodCardId: food.id,
    foodCategoryId: category.id,
  };
}
