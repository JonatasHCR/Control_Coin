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

describe('CSV import with a category column', () => {
  it('matches existing categories ignoring case and creates missing ones', async () => {
    const csv = ['data,descricao,valor,categoria', '2026-07-02,PADARIA,-45.00,food', '2026-07-03,CINEMA,-30.00,Lazer', '2026-07-04,PIX,50.00,'].join('\n');
    const result = await data.importCsv(f.userId, f.nubankId, csv, { date: 0, description: 1, amount: 2, category: 3 });
    expect(result.imported).toBe(3);
    expect(result.categoriesCreated).toEqual(['Lazer']);

    const padaria = await prisma.transaction.findFirstOrThrow({ where: { description: 'PADARIA' } });
    expect(padaria.categoryId).toBe(f.foodCategoryId);
    const pix = await prisma.transaction.findFirstOrThrow({ where: { description: 'PIX' } });
    expect(pix.categoryId).toBeNull();
  });
});

describe('CSV import as previstos (BR40)', () => {
  const csv = ['data,descricao,valor,categoria', '2026-09-10,IPVA,-1200.00,Food', '2026-12-20,13o,3000.00,'].join('\n');
  const columns = { date: 0, description: 1, amount: 2, category: 3 };

  it('creates pending plans that change no balance, once', async () => {
    const result = await data.importCsvPlanned(f.userId, f.nubankId, csv, columns, 5);
    expect(result.imported).toBe(2);
    expect(await prisma.transaction.count()).toBe(0);

    const ipva = await prisma.plannedTransaction.findFirstOrThrow({ where: { description: 'IPVA' } });
    expect(ipva).toMatchObject({ kind: 'EXPENSE', status: 'PENDING', accountId: f.nubankId, categoryId: f.foodCategoryId, notifyDaysBefore: 5 });
    expect((await prisma.plannedTransaction.findFirstOrThrow({ where: { description: '13o' } })).kind).toBe('INCOME');

    const again = await data.importCsvPlanned(f.userId, f.nubankId, csv, columns, 5);
    expect(again).toMatchObject({ imported: 0, duplicates: 2 });
  });
});

describe('CSV sign: minus is an expense, plus or no sign is an income', () => {
  it('reads "+", "R$ -" and plain amounts', async () => {
    const csv = ['data,descricao,valor', '2026-07-02,A,+120.00', '2026-07-03,B,R$ -45.00', '2026-07-04,C,10.00'].join(String.fromCharCode(10));
    const result = await data.importCsv(f.userId, f.nubankId, csv, columns);
    expect(result).toMatchObject({ imported: 3, errors: 0 });
    const kinds = Object.fromEntries((await prisma.transaction.findMany()).map((t) => [t.description, t.kind]));
    expect(kinds).toEqual({ A: 'INCOME', B: 'EXPENSE', C: 'INCOME' });
  });
});

