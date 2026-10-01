import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { money } from '@cc/domain/money';
import { ERROR_CODES } from '@cc/domain/rules';

import { BudgetsService } from '../budgets/budgets.service.js';
import { GoalsService } from './goals.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const budgets = new BudgetsService(prisma as never);
const goals = new GoalsService(prisma as never);
const notifications = new NotificationsService(prisma as never);

let f: Fixture;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

describe('BR23 — a budget with no limit inherits the category target', () => {
  it('uses the target when no explicit limit is set', async () => {
    await budgets.create(f.userId, { categoryId: f.foodCategoryId, periodStart: '2026-07-01' });
    const [row] = await budgets.list(f.userId, '2026-07');
    expect(row?.limit).toBe('1400.00'); // the seeded Alimentação target
    expect(row?.inheritsTarget).toBe(true);
  });

  it('an explicit limit overrides the target for that period', async () => {
    await budgets.create(f.userId, {
      categoryId: f.foodCategoryId,
      periodStart: '2026-07-01',
      limitAmount: '900.00',
    });
    const [row] = await budgets.list(f.userId, '2026-07');
    expect(row?.limit).toBe('900.00');
    expect(row?.inheritsTarget).toBe(false);
  });

  it('reports consumption once for the full total of a split (BR12)', async () => {
    await budgets.create(f.userId, { categoryId: f.foodCategoryId, periodStart: '2026-07-01' });
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: f.foodCategoryId,
      occurredOn: '2026-07-10',
      totalAmount: money('500.00'),
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'DEBIT', amount: money('300.00') },
        { side: 'SOURCE', accountId: f.nubankId, amount: money('200.00') },
      ],
    });
    const [row] = await budgets.list(f.userId, '2026-07');
    expect(row?.consumed).toBe('500.00');
    expect(row?.percent).toBe(36); // 500 / 1400
  });
});

describe('BR15 — a goal reads one source and never a card', () => {
  it('tracks a wallet balance, and follows it down', async () => {
    const goal = await goals.create(f.userId, {
      name: 'Reserva',
      targetAmount: money('20000.00'),
      deadline: '2026-12-31',
      sourceType: 'WALLET',
      walletId: f.walletId,
    });

    let listed = (await goals.list(f.userId)).find((g) => g.id === goal.id);
    expect(listed?.current).toBe('10000.00'); // Nubank initial balance

    // Spend from the wallet; progress goes down, never banked at a peak.
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: null,
      occurredOn: '2026-07-10',
      totalAmount: money('1000.00'),
      currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.nubankId, amount: money('1000.00') }],
    });

    listed = (await goals.list(f.userId)).find((g) => g.id === goal.id);
    expect(listed?.current).toBe('9000.00');
  });

  it('keeps only the source the type names, nulling a stray account', async () => {
    // The form may send all three fields; BR15 keeps exactly one. A WALLET goal
    // that also carries an accountId is coerced (accountId → null), and the
    // database CHECK remains the final guarantee against an invalid row.
    const goal = await goals.create(f.userId, {
      name: 'x',
      targetAmount: money('100.00'),
      deadline: '2026-12-31',
      sourceType: 'WALLET',
      walletId: f.walletId,
      accountId: f.itauId, // stray — must be dropped
    });
    const row = await prisma.goal.findUniqueOrThrow({ where: { id: goal.id } });
    expect(row.walletId).toBe(f.walletId);
    expect(row.accountId).toBeNull();
  });

  it('still rejects a WALLET goal with no wallet chosen', async () => {
    await expect(
      goals.create(f.userId, {
        name: 'x',
        targetAmount: money('100.00'),
        deadline: '2026-12-31',
        sourceType: 'WALLET',
        walletId: null,
        accountId: null,
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.VALIDATION_FAILED });
  });

  it('sums manual contributions and refuses them on a linked goal', async () => {
    const manual = await goals.create(f.userId, {
      name: 'Viagem',
      targetAmount: money('4000.00'),
      deadline: '2027-09-30',
      sourceType: 'MANUAL',
    });
    await goals.contribute(f.userId, manual.id, money('250.00'), '2026-07-01');
    await goals.contribute(f.userId, manual.id, money('250.00'), '2026-08-01');

    const listed = (await goals.list(f.userId)).find((g) => g.id === manual.id);
    expect(listed?.current).toBe('500.00');

    const linked = await goals.create(f.userId, {
      name: 'Conta',
      targetAmount: money('1000.00'),
      deadline: '2027-01-01',
      sourceType: 'ACCOUNT',
      accountId: f.itauId,
    });
    await expect(goals.contribute(f.userId, linked.id, money('10.00'), '2026-07-01')).rejects.toThrow();
  });
});

describe('BR28/BR32 — in-app notifications, escalating and withdrawn', () => {
  beforeEach(async () => {
    // A credit purchase whose invoice we can push overdue.
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: f.foodCategoryId,
      occurredOn: '2026-07-22',
      totalAmount: money('600.00'),
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('600.00') },
      ],
    });
    await prisma.$executeRaw`UPDATE invoice SET due_on = CURRENT_DATE - 3`;
  });

  it('raises one overdue notification, not one per evaluation (BR28)', async () => {
    await notifications.evaluate(f.userId, '2026-08-08');
    await notifications.evaluate(f.userId, '2026-08-08'); // idempotent
    await notifications.evaluate(f.userId, '2026-08-08');

    const { items } = { items: await notifications.list(f.userId) };
    const overdue = items.filter((n) => n.type === 'INVOICE_OVERDUE');
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.message).toContain('em atraso');
  });

  it('withdraws the notification once the invoice is paid', async () => {
    await notifications.evaluate(f.userId, '2026-08-08');
    expect(await notifications.unreadCount(f.userId)).toBeGreaterThan(0);

    // Clear the overdue condition directly — push the due date forward. The
    // point of the test is the withdrawal, not the payment path (that is
    // covered in the invoices suite).
    await prisma.$executeRaw`UPDATE invoice SET due_on = CURRENT_DATE + 10`;

    await notifications.evaluate(f.userId, '2026-08-09');
    const overdue = (await notifications.list(f.userId)).filter((n) => n.type === 'INVOICE_OVERDUE');
    expect(overdue).toHaveLength(0);
  });

  it('respects a dismissal — the same alert is not re-raised on re-evaluation (UC08)', async () => {
    await notifications.evaluate(f.userId, '2026-08-08');
    const raised = (await notifications.list(f.userId)).find((n) => n.type === 'INVOICE_OVERDUE');
    expect(raised).toBeDefined();

    await notifications.dismiss(f.userId, raised!.id);
    expect((await notifications.list(f.userId)).filter((n) => n.type === 'INVOICE_OVERDUE')).toHaveLength(0);

    // Condition unchanged: the dismissed alert stays gone, not resurrected.
    await notifications.evaluate(f.userId, '2026-08-08');
    expect((await notifications.list(f.userId)).filter((n) => n.type === 'INVOICE_OVERDUE')).toHaveLength(0);
  });

  it('nothing is ever sent — there is no channel column at all (BR28)', async () => {
    const columns = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
       WHERE table_name = 'alert_rule'`;
    expect(columns.map((c) => c.column_name)).not.toContain('channel');
  });
});

describe('UC08 — an invoice due-date reminder, opt-in and windowed', () => {
  beforeEach(async () => {
    // A credit purchase produces one open invoice whose due date we can move.
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-07-10', totalAmount: money('300.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('300.00') }],
    });
  });

  it('warns within the configured window, and withdraws once outside it', async () => {
    await notifications.createRule(f.userId, { type: 'INVOICE_DUE', daysBefore: 5 });
    const today = new Date().toISOString().slice(0, 10);

    // Due in three days — inside the five-day window.
    await prisma.$executeRaw`UPDATE invoice SET due_on = CURRENT_DATE + 3`;
    await notifications.evaluate(f.userId, today);
    let due = (await notifications.list(f.userId)).filter((n) => n.type === 'INVOICE_DUE_SOON');
    expect(due).toHaveLength(1);
    expect(due[0]?.message).toContain('vence');

    // Pushed to twenty days out — the reminder no longer applies.
    await prisma.$executeRaw`UPDATE invoice SET due_on = CURRENT_DATE + 20`;
    await notifications.evaluate(f.userId, today);
    due = (await notifications.list(f.userId)).filter((n) => n.type === 'INVOICE_DUE_SOON');
    expect(due).toHaveLength(0);
  });

  it('raises nothing without a rule — only overdue is unconditional (BR32)', async () => {
    const today = new Date().toISOString().slice(0, 10);
    await prisma.$executeRaw`UPDATE invoice SET due_on = CURRENT_DATE + 3`;
    await notifications.evaluate(f.userId, today);
    const due = (await notifications.list(f.userId)).filter((n) => n.type === 'INVOICE_DUE_SOON');
    expect(due).toHaveLength(0);
  });
});
