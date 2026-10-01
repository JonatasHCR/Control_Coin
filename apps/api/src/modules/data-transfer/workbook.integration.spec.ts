import ExcelJS from 'exceljs';
import { beforeEach, describe, expect, it } from 'vitest';

import { WorkbookService } from './workbook.service.js';
import { prisma, resetDatabase, seed, transactions, type Fixture } from '../../../test/harness.js';

const workbook = new WorkbookService(prisma as never, transactions);

let f: Fixture;

beforeEach(async () => {
  await resetDatabase();
  f = await seed();
});

/** Download the template, let `fill` type into it, and hand back the file. */
async function filled(fill: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load((await workbook.template(f.userId)) as unknown as ArrayBuffer);
  fill(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const append = (wb: ExcelJS.Workbook, sheet: string, values: unknown[]) => {
  const s = wb.getWorksheet(sheet)!;
  let r = 2;
  while (s.getRow(r).getCell(1).value !== null && s.getRow(r).getCell(1).value !== undefined) r += 1;
  values.forEach((v, i) => (s.getRow(r).getCell(i + 1).value = v as ExcelJS.CellValue));
};

describe('UC09 — fill-in workbook', () => {
  it('comes pre-filled with the existing cadastros', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await workbook.template(f.userId)) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('Contas')!.getCell('A2').value).toBeTruthy();
    expect(wb.getWorksheet('Cartões')!.getCell('A2').value).toBe('Buy');
  });

  it('creates new cadastros and lançamentos; installments and invoices are derived', async () => {
    const file = await filled((wb) => {
      append(wb, 'Contas', ['Carteira física', 'Dinheiro', '', 50]);
      append(wb, 'Categorias', ['Lazer', '', 'Não', 300]);
      append(wb, 'Lançamentos', [new Date('2026-07-10'), 'Despesa', 'TV', 1200, '', 'Buy', 'Crédito', 3, 'Lazer']);
      append(wb, 'Lançamentos', [new Date('2026-07-11'), 'Despesa', 'Pastel', '12,50', 'Carteira física', '', '', '', 'Food']);
      append(wb, 'Lançamentos', [new Date('2026-07-11'), 'Despesa', 'Pastel', '12,50', 'Carteira física', '', '', '', 'Food']);
      append(wb, 'Lançamentos', [new Date('2026-07-05'), 'Receita', 'Salário', 5000, 'Nubank']);
      append(wb, 'Lançamentos', [new Date('2026-07-06'), 'Transferência', '', 100, 'Nubank', '', '', '', '', 'Carteira física']);
    });

    const result = await workbook.import(f.userId, file);
    expect(result.errors).toEqual([]);
    expect(result.created).toMatchObject({ accounts: 1, categories: 1, transactions: 5 });

    const tv = await prisma.transaction.findFirst({ where: { description: 'TV' }, include: { entries: { include: { settlements: true } } } });
    expect(tv!.entries[0]!.settlements).toHaveLength(3);
    expect(await prisma.transaction.count({ where: { description: 'Pastel' } })).toBe(2); // same row twice = two purchases

    const again = await workbook.import(f.userId, file);
    expect(again.created.transactions).toBe(0);
    expect(again.skipped).toBe(5);
  });

  it('writes nothing when any row is wrong, and says where', async () => {
    const file = await filled((wb) => {
      append(wb, 'Contas', ['Nova', 'Dinheiro']);
      append(wb, 'Lançamentos', [new Date('2026-07-10'), 'Despesa', 'X', 10, 'Conta que não existe']);
    });
    await expect(workbook.import(f.userId, file)).rejects.toMatchObject({
      detail: { errors: [expect.stringContaining('Lançamentos, linha 2')] },
    });
    expect(await prisma.account.count({ where: { name: 'Nova' } })).toBe(0);
  });
});
