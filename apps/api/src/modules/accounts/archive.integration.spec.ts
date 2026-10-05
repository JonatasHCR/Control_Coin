import { beforeEach, describe, expect, it } from 'vitest';

import { AccountsService } from './accounts.service.js';
import { prisma, resetDatabase, seed, type Fixture } from '../../../test/harness.js';

const accounts = new AccountsService(prisma as never);

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

describe('UC02 — archived things can be found and brought back', () => {
  it('lists an archived card and restores it to the tree', async () => {
    await accounts.archive(f.userId, 'CARD', f.foodCardId);
    const hidden = await accounts.archived(f.userId);
    expect(hidden.cards.map((c) => c.name)).toEqual(['Food']);

    await accounts.archive(f.userId, 'CARD', f.foodCardId, false);
    const tree = await accounts.tree(f.userId);
    expect(tree.wallets[0]!.accounts[0]!.cards.map((c) => c.name)).toContain('Food');
    expect((await accounts.archived(f.userId)).cards).toHaveLength(0);
  });

  it('says how many accounts come back with an archived wallet', async () => {
    await accounts.archive(f.userId, 'WALLET', f.walletId);
    const hidden = await accounts.archived(f.userId);
    expect(hidden.wallets).toEqual([{ id: f.walletId, name: 'Emergency', hiddenAccounts: 1 }]);
  });
});
