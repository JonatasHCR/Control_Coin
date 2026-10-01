import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DataTransferService } from './data-transfer.service.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const data = new DataTransferService(prisma as never, transactions);

let f: Fixture;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

const CSV = [
  'data,descricao,valor',
  '2026-07-02,PADARIA CENTRAL,-45.00',
  '2026-07-03,PIX RECEBIDO,120.00',
  '2026-07-04,MERCADO,-230.50',
].join('\n');

const columns = { date: 0, description: 1, amount: 2 };

describe('BR24 — imported rows are deduplicated, never merged', () => {
  it('imports the new rows once', async () => {
    const result = await data.importCsv(f.userId, f.nubankId, CSV, columns);
    expect(result.imported).toBe(3);
    expect(result.duplicates).toBe(0);

    const rows = await prisma.transaction.findMany({ where: { importBatchId: result.batchId } });
    expect(rows).toHaveLength(3);
  });

  it('skips a re-import of the same file rather than duplicating it', async () => {
    await data.importCsv(f.userId, f.nubankId, CSV, columns);
    const second = await data.importCsv(f.userId, f.nubankId, CSV, columns);
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(3);

    const all = await prisma.transaction.count({ where: { externalRef: { not: null } } });
    expect(all).toBe(3); // not 6
  });

  it('lands imported rows Uncategorized (BR01) with the right kind', async () => {
    await data.importCsv(f.userId, f.nubankId, CSV, columns);
    const income = await prisma.transaction.findFirst({ where: { kind: 'INCOME', description: 'PIX RECEBIDO' } });
    const expense = await prisma.transaction.findFirst({ where: { description: 'PADARIA CENTRAL' } });

    expect(income?.categoryId).toBeNull();
    expect(income?.totalAmount.toFixed(2)).toBe('120.00');
    expect(expense?.kind).toBe('EXPENSE');
    expect(expense?.totalAmount.toFixed(2)).toBe('45.00');
  });

  it('counts a malformed row as an error and imports the rest', async () => {
    const withBad = `${CSV}\n2026-07-05,SEM VALOR,`;
    const result = await data.importCsv(f.userId, f.nubankId, withBad, columns);
    expect(result.errors).toBe(1);
    expect(result.imported).toBe(3);
  });
});

describe('BR25 — export at two levels', () => {
  beforeEach(async () => {
    // The R$ 500 split: one transaction, four settlements.
    await transactions.create(f.userId, {
      kind: 'EXPENSE',
      occurrenceType: 'INSTALLMENT',
      categoryId: f.foodCategoryId,
      description: 'Supermercado',
      occurredOn: '2026-07-22',
      totalAmount: '500.00' as never,
      currency: 'BRL',
      entries: [
        { side: 'SOURCE', cardId: f.buyCardId, cardFunction: 'CREDIT', amount: '300.00' as never, installmentCount: 3 },
        { side: 'SOURCE', cardId: f.foodCardId, cardFunction: 'CREDIT', amount: '200.00' as never, installmentCount: 1 },
      ],
    });
  });

  it('is one row at transaction level', async () => {
    const csv = await data.exportCsv(f.userId, 'transaction');
    const rows = csv.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('date'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('Supermercado');
    expect(rows[0]).toContain('Buy 300.00 / Food 200.00'); // split summarised, not lost
  });

  it('is four rows at settlement level', async () => {
    const csv = await data.exportCsv(f.userId, 'settlement');
    const rows = csv.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('purchased'));
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.includes('/3')).length).toBe(3); // the 3× plan
  });

  it('states its level and generation date in the file', async () => {
    const csv = await data.exportCsv(f.userId, 'transaction');
    expect(csv).toMatch(/# Control_Coin export · level=transaction/);
  });
});
