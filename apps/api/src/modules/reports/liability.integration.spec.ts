import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { money } from '@cc/domain/money';

import { InvoicesService } from '../invoices/invoices.service.js';
import { ReportsRepository } from './reports.repository.js';
import { clock, prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

/**
 * BR39 — an account may record a debt instead of money held.
 *
 * The rule exists because netting the two into one figure answers neither
 * question: a user who owes R$ 500 and holds R$ 500 is not at zero, and a
 * balance that says so is worse than no balance at all.
 */
const reports = new ReportsRepository(prisma as never);
const invoices = new InvoicesService(prisma as never, transactions, clock);

let f: Fixture;
let loanId: string;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();

  const loan = await prisma.account.create({
    data: {
      userId: f.userId,
      walletId: f.walletId, // inside a wallet on purpose: it must still be excluded
      name: 'Empréstimo do Juraci',
      type: 'LIABILITY',
      currency: 'BRL',
      initialBalance: '0.00',
    },
  });
  loanId = loan.id;
});

const balanceFor = async (month: string) => reports.periodBalance(f.userId, `${month}-01`, null);

describe('BR39 — a debt is never counted as money held', () => {
  it('keeps a liability out of its wallet total (BR08)', async () => {
    await prisma.account.update({ where: { id: loanId }, data: { initialBalance: '-900.00' } });

    const [wallet] = await prisma.$queryRaw<{ balance: string }[]>`
      SELECT balance::text FROM v_wallet_balance WHERE wallet_id = ${f.walletId}::uuid`;

    // The Nubank account's own opening, and nothing of the debt.
    const nubank = await prisma.account.findUniqueOrThrow({ where: { id: f.nubankId } });
    expect(Number(wallet?.balance)).toBe(Number(nubank.initialBalance));
  });

  it('keeps a liability out of the period opening (BR34)', async () => {
    const before = await balanceFor('2026-07');
    await prisma.account.update({ where: { id: loanId }, data: { initialBalance: '-900.00' } });
    const after = await balanceFor('2026-07');

    expect(after?.opening_balance).toBe(before?.opening_balance);
  });

  it('never reads money leaving a liability as income or expense (BR14)', async () => {
    const before = await balanceFor('2026-07');

    // The loan pays a shop directly: the debt grows, the user's month does not.
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      description: 'Pago pelo Juraci',
      occurredOn: '2026-07-10',
      totalAmount: money('300.00'),
      currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: loanId, amount: money('300.00') }],
    });

    const after = await balanceFor('2026-07');
    expect(after?.expenses).toBe(before?.expenses);
    expect(after?.closing_balance).toBe(before?.closing_balance);
  });

  it('still reports what is owed, as a positive amount', async () => {
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      description: 'Pago pelo Juraci',
      occurredOn: '2026-07-10',
      totalAmount: money('300.00'),
      currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: loanId, amount: money('300.00') }],
    });

    const debts = await reports.debts(f.userId);
    expect(debts).toHaveLength(1);
    expect(debts[0]?.name).toBe('Empréstimo do Juraci');
    expect(debts[0]?.total).toBe('300.00'); // owed, not negative money
  });
});

describe('BR39/BR07 — a card charge leaves the account that paid the invoice', () => {
  it('is not the user\'s spending when a third party settled the bill', async () => {
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: f.foodCategoryId,
      description: 'Compra no crédito',
      occurredOn: '2026-07-22',
      totalAmount: money('400.00'),
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('400.00') },
      ],
    });

    const open = (await invoices.list(f.userId)).find((i) => Number(i.openAmount) > 0)!;
    const before = await balanceFor('2026-08');

    // The loan settles the invoice, so the money never leaves the user's own
    // accounts — the charge must not land on the card's parent account.
    await invoices.pay(f.userId, open.id, {
      paidOn: '2026-08-05',
      sources: [{ accountId: loanId, amount: open.openAmount }],
    });

    const after = await balanceFor('2026-08');
    expect(after?.expenses).toBe(before?.expenses);

    const debts = await reports.debts(f.userId);
    expect(debts[0]?.total).toBe('400.00');
  });
});
