import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { money } from '@cc/domain/money';

import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesService } from '../categories/categories.service.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const accounts = new AccountsService(prisma as never);
const categories = new CategoriesService(prisma as never);

let f: Fixture;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

describe('delete a transaction — the derived state restores itself (BR36)', () => {
  it('removes the transaction, its entries and its settlements', async () => {
    const tx = await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'INSTALLMENT',
      categoryId: f.foodCategoryId,
      occurredOn: '2026-07-22',
      totalAmount: money('300.00'),
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('300.00'), installmentCount: 3 },
      ],
    });
    expect(await prisma.settlement.count()).toBe(3);

    await transactions.remove(f.userId, tx.id);

    expect(await prisma.transaction.count()).toBe(0);
    expect(await prisma.entry.count()).toBe(0);
    expect(await prisma.settlement.count()).toBe(0);
  });

  it('restores an invoice open amount when its payment is deleted', async () => {
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-07-22', totalAmount: money('500.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('500.00') }],
    });
    const invoice = await prisma.invoice.findFirstOrThrow();

    // Pay it as a transfer, then delete the payment.
    const payment = await transactions.create(f.userId, {
      kind: 'TRANSFER', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-08-02', totalAmount: money('500.00'), currency: 'BRL',
      entries: [
        { side: 'SOURCE', accountId: f.nubankId, amount: money('500.00') },
        { side: 'DESTINATION', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('500.00') },
      ],
    });
    await prisma.$executeRaw`
      UPDATE settlement SET invoice_id = ${invoice.id}::uuid, settled_on = CURRENT_DATE
       WHERE entry_id IN (SELECT id FROM entry WHERE transaction_id = ${payment.id}::uuid AND side = 'DESTINATION')`;

    const paid = await openAmount(invoice.id);
    expect(paid).toBe('0.00');

    await transactions.remove(f.userId, payment.id);
    expect(await openAmount(invoice.id)).toBe('500.00'); // restored, no correction step
  });
});

describe('delete an account or card — archive when there is history (UC02)', () => {
  it('refuses to delete a card that has been used, and points at archive', async () => {
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-07-18', totalAmount: money('42.80'), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'DEBIT', amount: money('42.80') }],
    });
    await expect(accounts.remove(f.userId, 'CARD', f.buyCardId)).rejects.toBeInstanceOf(DomainError);
  });

  it('archives instead — the card is hidden but its history stays', async () => {
    await accounts.archive(f.userId, 'CARD', f.buyCardId);
    const card = await prisma.card.findUniqueOrThrow({ where: { id: f.buyCardId } });
    expect(card.archived).toBe(true);
    // The account it belongs to is untouched.
    expect(await prisma.card.count({ where: { accountId: f.nubankId } })).toBe(2);
  });

  it('refuses to delete an account that still owns cards', async () => {
    await expect(accounts.remove(f.userId, 'ACCOUNT', f.nubankId)).rejects.toBeInstanceOf(DomainError);
  });

  it('deletes an unused account cleanly', async () => {
    const fresh = await accounts.createAccount(f.userId, {
      name: 'Poupança', type: 'BANK', currency: 'BRL', initialBalance: '0.00',
    });
    const result = await accounts.remove(f.userId, 'ACCOUNT', fresh.id);
    expect(result).toEqual({ deleted: fresh.id });
  });
});

describe('delete a category — transactions survive (UC04)', () => {
  it('leaves its transactions Uncategorized, never deletes them', async () => {
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: f.foodCategoryId,
      occurredOn: '2026-07-10', totalAmount: money('80.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.nubankId, amount: money('80.00') }],
    });

    await categories.remove(f.userId, f.foodCategoryId);

    const tx = await prisma.transaction.findFirstOrThrow({ where: { description: null, totalAmount: '80.00' } });
    expect(tx.categoryId).toBeNull(); // BR01: Uncategorized, not deleted
    expect(await prisma.transaction.count()).toBe(1);
  });

  it('reassigns transactions to another category when asked', async () => {
    const other = await categories.create(f.userId, { name: 'Outros' });
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: f.foodCategoryId,
      occurredOn: '2026-07-10', totalAmount: money('80.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.nubankId, amount: money('80.00') }],
    });

    await categories.remove(f.userId, f.foodCategoryId, { reassignTo: other.id });

    const tx = await prisma.transaction.findFirstOrThrow({ where: { totalAmount: '80.00' } });
    expect(tx.categoryId).toBe(other.id);
  });

  it('promotes subcategories to top level rather than deleting them', async () => {
    const parent = await categories.create(f.userId, { name: 'Casa' });
    const child = await categories.create(f.userId, { name: 'Aluguel', parentId: parent.id });

    await categories.remove(f.userId, parent.id);

    const promoted = await prisma.category.findUniqueOrThrow({ where: { id: child.id } });
    expect(promoted.parentId).toBeNull();
  });
});

describe('replace a transaction — the only safe edit of amounts and sources (BR12/BR36)', () => {
  it('deletes the old spine and writes a fresh one, so derived state re-derives', async () => {
    const tx = await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: f.foodCategoryId,
      occurredOn: '2026-07-10', totalAmount: money('100.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.nubankId, amount: money('100.00') }],
    });

    const replaced = await transactions.replace(f.userId, tx.id, {
      kind: 'INCOME', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-07-20', totalAmount: money('250.00'), currency: 'BRL',
      entries: [{ side: 'DESTINATION', accountId: f.nubankId, amount: money('250.00') }],
    });

    // A replace is delete + create: a new id, and only the new spine survives.
    expect(replaced.id).not.toBe(tx.id);
    expect(await prisma.transaction.count()).toBe(1);
    expect(await prisma.entry.count()).toBe(1);

    const only = await prisma.transaction.findFirstOrThrow({ include: { entries: true } });
    expect(only.kind).toBe('INCOME');
    expect(only.totalAmount.toFixed(2)).toBe('250.00');
    expect(only.entries[0]?.side).toBe('DESTINATION');
  });

  it('rejects an unbalanced replacement and leaves the original intact (BR12)', async () => {
    const tx = await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-07-10', totalAmount: money('100.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.nubankId, amount: money('100.00') }],
    });

    await expect(
      transactions.replace(f.userId, tx.id, {
        kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
        occurredOn: '2026-07-10', totalAmount: money('100.00'), currency: 'BRL',
        entries: [{ side: 'SOURCE', accountId: f.nubankId, amount: money('60.00') }], // 60 ≠ 100
      }),
    ).rejects.toBeInstanceOf(DomainError);

    // The whole replace is one unit: the original still stands, unchanged.
    const survivor = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(survivor.totalAmount.toFixed(2)).toBe('100.00');
    expect(await prisma.transaction.count()).toBe(1);
  });
});

describe('changing a card cycle re-dates its unpaid invoices (BR07)', () => {
  it('moves the open invoice due date to match the new closing/due day', async () => {
    // buyCardId closes on the 28th, due on the 5th → a July purchase is due Aug 05.
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-07-10', totalAmount: money('200.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: money('200.00') }],
    });
    let invoice = await prisma.invoice.findFirstOrThrow({ where: { cardId: f.buyCardId } });
    expect(invoice.dueOn.toISOString().slice(0, 10)).toBe('2026-08-05');

    // Move the card to close 04 / due 11 — the due day is now the later of the
    // two, so the still-open invoice's due date lands in the same month.
    await accounts.updateCard(f.userId, f.buyCardId, { closingDay: 4, dueDay: 11 });

    invoice = await prisma.invoice.findFirstOrThrow({ where: { cardId: f.buyCardId } });
    expect(invoice.closesOn.toISOString().slice(0, 10)).toBe('2026-07-04');
    expect(invoice.dueOn.toISOString().slice(0, 10)).toBe('2026-07-11');
  });
});

describe('a credit charge lands on the invoice its closing day decides (BR07)', () => {
  // A card that closes on the 4th and is due on the 11th — the due day is the
  // later of the two, so the due date sits in the *same* month as the close.
  async function makeCard() {
    return accounts.createCard(f.userId, {
      accountId: f.nubankId,
      name: 'Sky',
      allowsCredit: true,
      allowsDebit: false,
      creditLimit: money('5000.00'),
      closingDay: 4,
      dueDay: 11,
    });
  }

  async function invoiceFor(cardId: string) {
    return prisma.invoice.findFirstOrThrow({ where: { cardId } });
  }

  it('a purchase before the closing day is billed this cycle (close 04 → due 11 same month)', async () => {
    const card = await makeCard();
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-07-02', totalAmount: money('120.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: card.id, cardFunction: 'CREDIT', amount: money('120.00') }],
    });

    const invoice = await invoiceFor(card.id);
    expect(invoice.closesOn.toISOString().slice(0, 10)).toBe('2026-07-04');
    expect(invoice.dueOn.toISOString().slice(0, 10)).toBe('2026-07-11');
  });

  it('a purchase after the closing day rolls to the next cycle (due 11 next month)', async () => {
    const card = await makeCard();
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'OCCASIONAL', categoryId: null,
      occurredOn: '2026-07-10', totalAmount: money('120.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: card.id, cardFunction: 'CREDIT', amount: money('120.00') }],
    });

    const invoice = await invoiceFor(card.id);
    expect(invoice.closesOn.toISOString().slice(0, 10)).toBe('2026-08-04');
    expect(invoice.dueOn.toISOString().slice(0, 10)).toBe('2026-08-11');
  });

  it('splits a 2× purchase across consecutive cycles, each due on the 11th', async () => {
    const card = await makeCard();
    await transactions.create(f.userId, {
      kind: 'EXPENSE', occurrenceType: 'INSTALLMENT', categoryId: null,
      occurredOn: '2026-07-02', totalAmount: money('200.00'), currency: 'BRL',
      entries: [{ side: 'SOURCE', cardId: card.id, cardFunction: 'CREDIT', amount: money('200.00'), installmentCount: 2 }],
    });

    const invoices = await prisma.invoice.findMany({
      where: { cardId: card.id },
      orderBy: { dueOn: 'asc' },
    });
    expect(invoices.map((i) => i.dueOn.toISOString().slice(0, 10))).toEqual([
      '2026-07-11',
      '2026-08-11',
    ]);
  });
});

async function openAmount(invoiceId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ open_amount: unknown }[]>`
    SELECT open_amount FROM v_invoice_total WHERE invoice_id = ${invoiceId}::uuid`;
  return Number(String(rows[0]?.open_amount ?? 0)).toFixed(2);
}
