import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { money } from '@cc/domain/money';
import { ERROR_CODES } from '@cc/domain/rules';

import { Clock, FixedClock } from '../../common/clock/clock.js';
import { InvoicesService } from './invoices.service.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const clock: Clock = new FixedClock('2026-08-09');
const invoices = new InvoicesService(prisma as never, transactions, clock);

let f: Fixture;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();

  // A R$ 1.180,00 credit purchase on Buy, bought 22 July → July cycle, due 5 Aug.
  await transactions.create(f.userId, {
    kind: 'EXPENSE',
    occurrenceType: 'OCCASIONAL',
    categoryId: f.foodCategoryId,
    description: 'Compra grande',
    occurredOn: '2026-07-22',
    totalAmount: money('1180.00'),
    currency: 'BRL',
    entries: [
      { side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('1180.00') },
    ],
  });
});

const openInvoice = async () => (await invoices.list(f.userId)).find((i) => Number(i.openAmount) > 0)!;

describe('BR31 — paying an invoice is a transfer, never an expense', () => {
  it('reduces the paying account and the open amount together', async () => {
    const invoice = await openInvoice();
    expect(invoice.openAmount).toBe('1180.00');

    const paid = await invoices.pay(f.userId, invoice.id, {
      paidOn: '2026-08-02',
      sources: [{ accountId: f.nubankId, amount: '700.00' }],
    });

    expect(paid?.paid).toBe('700.00');
    expect(paid?.openAmount).toBe('480.00'); // the remainder stays owed

    const [balance] = await prisma.$queryRaw<{ balance: string }[]>`
      SELECT balance::text FROM v_account_balance WHERE account_id = ${f.nubankId}::uuid`;
    expect(Number(balance?.balance)).toBe(9300); // 10000 − 700
  });

  it('never counts the payment as spending (BR14)', async () => {
    const invoice = await openInvoice();
    const before = await expenseTotal();

    await invoices.pay(f.userId, invoice.id, {
      paidOn: '2026-08-02',
      sources: [{ accountId: f.nubankId, amount: '1180.00' }],
    });

    // The purchase counted in July; the payment adds nothing.
    expect(await expenseTotal()).toBe(before);
  });

  it('accepts a payment split across two accounts (BR12)', async () => {
    const invoice = await openInvoice();

    const paid = await invoices.pay(f.userId, invoice.id, {
      paidOn: '2026-08-02',
      sources: [
        { accountId: f.nubankId, amount: '900.00' },
        { accountId: f.itauId, amount: '280.00' },
      ],
    });

    expect(paid?.openAmount).toBe('0.00');
    expect(paid?.status).toBe('PAID');
  });

  it('rejects paying more than is open — a card is not a savings account', async () => {
    const invoice = await openInvoice();

    await expect(
      invoices.pay(f.userId, invoice.id, {
        paidOn: '2026-08-02',
        sources: [{ accountId: f.nubankId, amount: '2000.00' }],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.OVERPAYMENT });
  });
});

describe('BR32 — invoice status is derived, never set by hand', () => {
  it('is PARTIALLY_PAID while a remainder is owed', async () => {
    const invoice = await openInvoice();
    const paid = await invoices.pay(f.userId, invoice.id, {
      paidOn: '2026-08-02',
      sources: [{ accountId: f.nubankId, amount: '700.00' }],
    });
    expect(paid?.status).toBe('PARTIALLY_PAID');
  });

  it('reports overdue once the due date passes with an amount open', async () => {
    // Due 5 Aug; nothing paid. The view derives it from CURRENT_DATE.
    await prisma.$executeRaw`UPDATE invoice SET due_on = CURRENT_DATE - 4`;
    const invoice = await openInvoice();
    expect(invoice.isOverdue).toBe(true);
    expect(invoice.daysOverdue).toBe(4);
  });

  it('stops being overdue as soon as it is paid in full', async () => {
    await prisma.$executeRaw`UPDATE invoice SET due_on = CURRENT_DATE - 4`;
    const invoice = await openInvoice();

    const paid = await invoices.pay(f.userId, invoice.id, {
      paidOn: '2026-08-09',
      sources: [{ accountId: f.nubankId, amount: '1180.00' }],
    });

    expect(paid?.isOverdue).toBe(false);
    expect(paid?.status).toBe('PAID');
  });
});

describe('BR36 — invoice figures are derived, so deleting a payment restores them', () => {
  it('returns the open amount when the payment transaction is removed', async () => {
    const invoice = await openInvoice();
    await invoices.pay(f.userId, invoice.id, {
      paidOn: '2026-08-02',
      sources: [{ accountId: f.nubankId, amount: '700.00' }],
    });

    const payment = await prisma.transaction.findFirstOrThrow({
      where: { kind: 'TRANSFER' },
      orderBy: { createdAt: 'desc' },
    });
    await prisma.transaction.delete({ where: { id: payment.id } });

    const after = (await invoices.list(f.userId)).find((i) => i.id === invoice.id);
    expect(after?.paid).toBe('0.00');
    expect(after?.openAmount).toBe('1180.00'); // no correction step needed
  });
});

async function expenseTotal(): Promise<string> {
  const rows = await prisma.$queryRaw<{ total: unknown }[]>`
    SELECT COALESCE(SUM(expense_total), 0) AS total FROM v_monthly_expense`;
  return Number(String(rows[0]?.total ?? 0)).toFixed(2);
}

describe('BR07 — a credit charge reaches the account when the invoice is paid', () => {
  const chargeSettlements = async (invoiceId: string) =>
    prisma.settlement.findMany({
      where: { invoiceId, entry: { side: 'SOURCE' } },
      select: { settledOn: true, amount: true },
    });

  it('leaves the charge unsettled while the invoice is open', async () => {
    const invoice = await openInvoice();
    const before = await chargeSettlements(invoice.id);

    expect(before).toHaveLength(1);
    expect(before[0]!.settledOn).toBeNull();
  });

  it('settles the charge on the day the invoice is paid', async () => {
    const invoice = await openInvoice();

    await invoices.pay(f.userId, invoice.id, {
      paidOn: '2026-08-05',
      sources: [{ accountId: f.nubankId, amount: invoice.openAmount }],
    });

    const after = await chargeSettlements(invoice.id);
    expect(after[0]!.settledOn).toEqual(new Date('2026-08-05'));
  });

  it('leaves the charge owed when the payment only covers part of it', async () => {
    const invoice = await openInvoice();

    await invoices.pay(f.userId, invoice.id, {
      paidOn: '2026-08-05',
      sources: [{ accountId: f.nubankId, amount: '500.00' }],
    });

    const after = await chargeSettlements(invoice.id);
    expect(after[0]!.settledOn).toBeNull();
  });
});
