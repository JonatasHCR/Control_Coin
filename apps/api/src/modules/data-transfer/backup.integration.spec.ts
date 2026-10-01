import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { BackupService } from './backup.service.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const backup = new BackupService(prisma as never);

let f: Fixture;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
  await transactions.create(f.userId, {
    kind: 'EXPENSE',
    occurrenceType: 'INSTALLMENT',
    categoryId: f.foodCategoryId,
    description: 'TV',
    occurredOn: '2026-07-10',
    totalAmount: '1200.00',
    currency: 'BRL',
    entries: [{ side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: '1200.00', installmentCount: 3 }],
  } as never);
});

const balances = (userId: string) =>
  prisma.$queryRaw<{ balance: string }[]>`
    SELECT balance::text FROM v_account_balance WHERE user_id = ${userId}::uuid ORDER BY balance`;

describe('UC09 — full backup round-trips every row', () => {
  it('restores into another user with the same balances and installments', async () => {
    const file = Buffer.from(JSON.stringify(await backup.export(f.userId)));
    const other = await prisma.user.create({ data: { username: 'outro', passwordHash: 'x' } });

    const counts = await backup.restore(other.id, file, false);
    expect(counts.transactions).toBe(1);

    expect(await prisma.card.count({ where: { account: { userId: other.id } } })).toBe(
      await prisma.card.count({ where: { account: { userId: f.userId } } }),
    );
    expect(await prisma.settlement.count({ where: { entry: { transaction: { userId: other.id } } } })).toBe(3);
    expect(await balances(other.id)).toEqual(await balances(f.userId));
  });

  it('refuses to restore over existing data unless asked to replace', async () => {
    const file = Buffer.from(JSON.stringify(await backup.export(f.userId)));
    await expect(backup.restore(f.userId, file, false)).rejects.toThrow();

    await backup.restore(f.userId, file, true);
    expect(await prisma.transaction.count({ where: { userId: f.userId } })).toBe(1);
  });

  it('rejects a file that is not a backup', async () => {
    await expect(backup.restore(f.userId, Buffer.from('{"foo":1}'), true)).rejects.toThrow();
  });
});
