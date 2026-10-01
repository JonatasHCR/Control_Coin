import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { money } from '@cc/domain/money';

import { AccountsService } from '../accounts/accounts.service.js';
import { CategoriesService } from './categories.service.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const categories = new CategoriesService(prisma as never);
const accounts = new AccountsService(prisma as never);

let f: Fixture;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

describe('BR13 — a category is not tied to a kind', () => {
  it('classifies both an income and an expense', async () => {
    const shared = await categories.create(f.userId, { name: 'Freelance' });

    await transactions.create(f.userId, {
      kind: 'INCOME',
      occurrenceType: 'OCCASIONAL',
      categoryId: shared.id,
      occurredOn: '2026-07-05',
      totalAmount: money('2000.00'),
      currency: 'BRL',
      entries: [{ side: 'DESTINATION', accountId: f.nubankId, amount: money('2000.00') }],
    });

    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: shared.id,
      occurredOn: '2026-07-06',
      totalAmount: money('150.00'),
      currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.nubankId, amount: money('150.00') }],
    });

    // Never netted: the expense view sees 150, not −1850 (BR13).
    const [row] = await prisma.$queryRaw<{ total: unknown }[]>`
      SELECT COALESCE(SUM(expense_total), 0) AS total FROM v_monthly_expense`;
    expect(Number(String(row?.total)).toFixed(2)).toBe('150.00');
  });
});

describe('BR17/BR20 — the essential flag and the target live on the category', () => {
  it('flags a subcategory independently of its parent', async () => {
    const home = await categories.create(f.userId, { name: 'Casa' });
    const rent = await categories.create(f.userId, {
      name: 'Aluguel',
      parentId: home.id,
      isEssential: true,
      monthlyTarget: '1180.00',
    });

    const listed = await categories.list(f.userId);
    expect(listed.find((c) => c.id === home.id)?.isEssential).toBe(false);
    expect(listed.find((c) => c.id === rent.id)?.isEssential).toBe(true);
  });

  it('has no target until one is stated — null is not zero', async () => {
    const created = await categories.create(f.userId, { name: 'Lazer' });
    const listed = await categories.list(f.userId);
    expect(listed.find((c) => c.id === created.id)?.monthlyTarget).toBeNull();
  });
});

describe('BR17 — re-flagging a category rewrites past reports, and is audited', () => {
  beforeEach(async () => {
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'OCCASIONAL',
      categoryId: f.foodCategoryId,
      occurredOn: '2026-07-10',
      totalAmount: money('400.00'),
      currency: 'BRL',
      entries: [{ side: 'SOURCE', accountId: f.nubankId, amount: money('400.00') }],
    });
  });

  it('changes what an already-closed month counted as essential', async () => {
    const before = await essentialTotal();
    expect(before).toBe('400.00'); // seeded category is essential

    await categories.update(f.userId, f.foodCategoryId, { isEssential: false });

    // The same month now reports differently — the flag is read at query time.
    expect(await essentialTotal()).toBe('0.00');
  });

  it('writes an audit event, so the change is explainable', async () => {
    await categories.update(f.userId, f.foodCategoryId, { isEssential: false });

    const events = await prisma.$queryRaw<{ action: string; before: unknown; after: unknown }[]>`
      SELECT action, before, after FROM audit_event WHERE entity_id = ${f.foodCategoryId}::uuid`;

    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('RETROACTIVE_CHANGE');
    expect(events[0]?.before).toMatchObject({ isEssential: true });
    expect(events[0]?.after).toMatchObject({ isEssential: false });
  });

  it('does not audit a rename — only a change that rewrites history', async () => {
    await categories.update(f.userId, f.foodCategoryId, { name: 'Mercado' });
    const events = await prisma.$queryRaw<unknown[]>`
      SELECT 1 FROM audit_event WHERE entity_id = ${f.foodCategoryId}::uuid`;
    expect(events).toHaveLength(0);
  });
});

describe('BR06/BR08 — the hierarchy and its roll-up', () => {
  it('reports a wallet as the sum of its accounts, with cards listed under them', async () => {
    const tree = await accounts.tree(f.userId);
    const emergency = tree.wallets.find((w) => w.name === 'Emergency');

    expect(emergency?.balance).toBe('10000.00');
    expect(emergency?.accounts[0]?.name).toBe('Nubank');
    expect(emergency?.accounts[0]?.cards.map((c) => c.name).sort()).toEqual(['Buy', 'Food']);
  });

  it('keeps an account with no wallet reachable (BR16)', async () => {
    const tree = await accounts.tree(f.userId);
    expect(tree.unassigned.map((a) => a.name)).toContain('Itaú');
  });

  it('offers only the functions a card enables (BR09)', async () => {
    const tree = await accounts.tree(f.userId);
    const cards = tree.wallets[0]?.accounts[0]?.cards ?? [];
    expect(cards.find((c) => c.name === 'Buy')?.functions).toEqual(['CREDIT', 'DEBIT']);
    expect(cards.find((c) => c.name === 'Food')?.functions).toEqual(['CREDIT']);
  });
});

async function essentialTotal(): Promise<string> {
  const rows = await prisma.$queryRaw<{ total: unknown }[]>`
    SELECT COALESCE(SUM(essential_total), 0) AS total FROM v_monthly_expense`;
  return Number(String(rows[0]?.total ?? 0)).toFixed(2);
}
