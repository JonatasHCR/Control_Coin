import ExcelJS from 'exceljs';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { XlsxService } from './xlsx.service.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const xlsx = new XlsxService(prisma as never, transactions);

let f: Fixture;

beforeAll(async () => {
  await prisma.$connect();
});

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

/**
 * Build a workbook that deliberately carries every BR26 hazard: a title block
 * above the header, a blank row, a formula cell, an amount that would lose a
 * cent as a float, dates as real dates, and a trailing totals row.
 */
async function hazardousWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const s = wb.addWorksheet('Lançamentos');

  s.addRow(['Extrato — Banco Exemplo']); // a title block, not the header (BR26)
  s.addRow([]); // a blank row
  s.addRow(['data', 'descricao', 'valor']); // the real header, on row 3

  s.addRow([new Date(Date.UTC(2026, 6, 2)), 'Padaria', -45.0]);
  s.addRow([new Date(Date.UTC(2026, 6, 3)), 'Pix recebido', 120.0]);

  // An amount a float would mangle; written as text to force string parsing.
  const tricky = s.addRow([new Date(Date.UTC(2026, 6, 4)), 'Mercado', '1234.56']);
  void tricky;

  // A formula cell with a cached result — must use the cache, not recompute.
  const formulaRow = s.addRow([new Date(Date.UTC(2026, 6, 5)), 'Farmácia', null]);
  formulaRow.getCell(3).value = { formula: 'A1', result: -30.5 };

  s.addRow([null, 'TOTAL', -1350.06]); // a trailing totals row (BR26)

  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('BR26 — a spreadsheet is read safely, hazard by hazard', () => {
  it('finds the header below a title block and imports the real rows', async () => {
    const result = await xlsx.import(f.userId, f.nubankId, await hazardousWorkbook());
    // Four data rows import; the title, blank and totals rows do not.
    expect(result.imported).toBe(4);
    expect(result.errors).toBe(0);
    expect(result.sheet).toBe('Lançamentos');
  });

  it('never loses a cent — the tricky amount lands exactly', async () => {
    await xlsx.import(f.userId, f.nubankId, await hazardousWorkbook());
    const mercado = await prisma.transaction.findFirst({ where: { description: 'Mercado' } });
    expect(mercado?.totalAmount.toFixed(2)).toBe('1234.56');
  });

  it('reads a formula at its cached value', async () => {
    await xlsx.import(f.userId, f.nubankId, await hazardousWorkbook());
    const pharmacy = await prisma.transaction.findFirst({ where: { description: 'Farmácia' } });
    expect(pharmacy?.totalAmount.toFixed(2)).toBe('30.50');
    expect(pharmacy?.kind).toBe('EXPENSE');
  });

  it('excludes the trailing totals row', async () => {
    await xlsx.import(f.userId, f.nubankId, await hazardousWorkbook());
    const total = await prisma.transaction.findFirst({ where: { description: 'TOTAL' } });
    expect(total).toBeNull();
  });

  it('signs rows by the amount: positive income, negative expense', async () => {
    await xlsx.import(f.userId, f.nubankId, await hazardousWorkbook());
    const pix = await prisma.transaction.findFirst({ where: { description: 'Pix recebido' } });
    expect(pix?.kind).toBe('INCOME');
    expect(pix?.totalAmount.toFixed(2)).toBe('120.00');
  });
});

describe('BR24 — Excel import deduplicates too', () => {
  it('skips a re-import of the same workbook', async () => {
    await xlsx.import(f.userId, f.nubankId, await hazardousWorkbook());
    const second = await xlsx.import(f.userId, f.nubankId, await hazardousWorkbook());
    expect(second.imported).toBe(0);
    expect(second.duplicates).toBe(4);
  });
});

describe('BR26/BR25 — the export workbook has both levels', () => {
  beforeEach(async () => {
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

  it('writes the five sheets with money as numbers, not text', async () => {
    const buffer = await xlsx.export(f.userId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);

    expect(wb.worksheets.map((w) => w.name)).toEqual([
      'Summary',
      'Transactions',
      'Settlements',
      'Categories',
      'Accounts',
    ]);

    // One transaction row, four settlement rows — the R$ 500 split (BR25).
    expect(wb.getWorksheet('Transactions')!.rowCount).toBe(2); // header + 1
    expect(wb.getWorksheet('Settlements')!.rowCount).toBe(5); // header + 4

    // The amount cell is a number the user can sum, not a string.
    const amountCell = wb.getWorksheet('Transactions')!.getRow(2).getCell(5);
    expect(typeof amountCell.value).toBe('number');
    expect(amountCell.value).toBe(500);
  });
});
