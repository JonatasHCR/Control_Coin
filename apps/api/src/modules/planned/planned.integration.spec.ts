import { beforeEach, describe, expect, it } from 'vitest';

import { NotificationsService } from '../notifications/notifications.service.js';
import { PlannedService } from './planned.service.js';
import { clock, prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const planned = new PlannedService(prisma as never, transactions, clock);
const notifications = new NotificationsService(prisma as never);

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

const plan = (over: Partial<Parameters<PlannedService['create']>[1]> = {}) =>
  planned.create(f.userId, {
    kind: 'EXPENSE',
    description: 'Aluguel',
    categoryId: null,
    amount: '1500.00',
    expectedOn: '2026-08-10',
    accountId: f.nubankId,
    cardId: null,
    cardFunction: null,
    destinationAccountId: null,
    notifyDaysBefore: 3,
    ...over,
  });

const balance = async (accountId: string) =>
  (await prisma.$queryRaw<{ balance: string }[]>`
    SELECT balance::text FROM v_account_balance WHERE account_id = ${accountId}::uuid`)[0]!.balance;

describe('BR40 — a planned transaction is a forecast, not a movement', () => {
  it('changes no balance until it is confirmed', async () => {
    const before = await balance(f.nubankId);
    await plan();
    expect(await balance(f.nubankId)).toBe(before);
    expect(await prisma.transaction.count()).toBe(0);
  });

  it('confirming records what actually happened, which may differ from the plan', async () => {
    const p = await plan();
    await planned.confirm(f.userId, p.id, {
      occurredOn: '2026-08-12',
      amount: '1480.00',
      categoryId: f.foodCategoryId,
      accountId: f.itauId, // planned Nubank, paid from Itaú
      cardId: null,
      cardFunction: null,
      installmentCount: 1,
      destinationAccountId: null,
    });

    const t = await prisma.transaction.findFirstOrThrow({ include: { entries: true } });
    expect(t.totalAmount.toFixed(2)).toBe('1480.00');
    expect(t.entries[0]!.accountId).toBe(f.itauId);
    const row = await prisma.plannedTransaction.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.status).toBe('CONFIRMED');
    expect(row.transactionId).toBe(t.id);
  });

  it('confirms an income into an account and a transfer between two', async () => {
    const income = await plan({ kind: 'INCOME', description: 'Freela', accountId: null });
    await planned.confirm(f.userId, income.id, {
      occurredOn: '2026-08-10', amount: '800.00', categoryId: null, accountId: f.nubankId,
      cardId: null, cardFunction: null, installmentCount: 1, destinationAccountId: null,
    });
    const transfer = await plan({ kind: 'TRANSFER', description: 'Reserva' });
    await planned.confirm(f.userId, transfer.id, {
      occurredOn: '2026-08-10', amount: '200.00', categoryId: null, accountId: f.nubankId,
      cardId: null, cardFunction: null, installmentCount: 1, destinationAccountId: f.itauId,
    });
    expect(await prisma.transaction.count({ where: { kind: 'INCOME' } })).toBe(1);
    expect(await prisma.transaction.count({ where: { kind: 'TRANSFER' } })).toBe(1);
  });

  it('"did not happen" records nothing', async () => {
    const p = await plan();
    await planned.cancel(f.userId, p.id);
    expect(await prisma.transaction.count()).toBe(0);
    await expect(planned.cancel(f.userId, p.id)).rejects.toThrow();
  });

  it('asks for confirmation from the reminder window on, and withdraws once resolved', async () => {
    const p = await plan(); // expected 10/08, remind 3 days before

    await notifications.evaluate(f.userId, '2026-08-06');
    expect(await notifications.list(f.userId)).toHaveLength(0);

    await notifications.evaluate(f.userId, '2026-08-07');
    const [n] = await notifications.list(f.userId);
    expect(n!.message).toContain('daqui a 3 dia(s)');
    expect(n!.href).toBe(`/planned?confirm=${p.id}`);

    await notifications.evaluate(f.userId, '2026-08-12');
    expect((await notifications.list(f.userId))[0]!.message).toContain('há 2 dia(s)');

    await planned.cancel(f.userId, p.id);
    await notifications.evaluate(f.userId, '2026-08-12');
    expect(await notifications.list(f.userId)).toHaveLength(0);
  });

  it('postpones only forward and never into the past', async () => {
    const p = await plan(); // expected 10/08; the test clock says 24/07

    await expect(planned.postpone(f.userId, p.id, '2026-08-10')).rejects.toThrow();
    const late = await plan({ expectedOn: '2026-07-01' });
    await expect(planned.postpone(f.userId, late.id, '2026-07-10')).rejects.toThrow('passado');

    await planned.postpone(f.userId, p.id, '2026-09-10');
    const row = await prisma.plannedTransaction.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.expectedOn.toISOString().slice(0, 10)).toBe('2026-09-10');
    expect(row.status).toBe('PENDING');
  });

  it('a postponed plan stops asking until its new window', async () => {
    const p = await plan();
    await notifications.evaluate(f.userId, '2026-08-12');
    expect(await notifications.list(f.userId)).toHaveLength(1);

    await planned.postpone(f.userId, p.id, '2026-09-10');
    await notifications.evaluate(f.userId, '2026-08-12');
    expect(await notifications.list(f.userId)).toHaveLength(0);
  });
});
