import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import ExcelJS from 'exceljs';

import { money, type Money } from '@cc/domain/money';
import { ERROR_CODES } from '@cc/domain/rules';

import { DomainError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { categoryMatcher } from './category-matcher.js';

/**
 * Excel import and export (UC09, BR26).
 *
 * A spreadsheet is a document, not a data format. The four hazards from the use
 * case are handled explicitly on import; on export the workbook carries both
 * levels at once (the reason to offer Excel at all) with currency-formatted
 * numbers and real dates.
 *
 * Money never passes through a float on the way in: the amount cell is read as
 * its displayed string and parsed to exact decimal (BR26/BR36).
 */
@Injectable()
export class XlsxService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  // ── Export: one workbook, five sheets ────────────────────────────────────

  async export(userId: string): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Control_Coin';
    wb.created = new Date();

    await this.sheetSummary(wb, userId);
    await this.sheetTransactions(wb, userId);
    await this.sheetSettlements(wb, userId);
    await this.sheetCategories(wb, userId);
    await this.sheetAccounts(wb, userId);

    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  private headerize(sheet: ExcelJS.Worksheet, headers: string[]): void {
    sheet.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(h.length + 2, 14) }));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }]; // frozen header row (BR26)
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  }

  /** Money as a NUMBER with a currency format, so the user can sum it (BR26). */
  private moneyCell(cell: ExcelJS.Cell, amount: string): void {
    cell.value = Number(amount);
    cell.numFmt = 'R$ #,##0.00';
  }

  private async sheetSummary(wb: ExcelJS.Workbook, userId: string): Promise<void> {
    const s = wb.addWorksheet('Summary');
    const month = `${new Date().toISOString().slice(0, 7)}-01`;
    const [col] = await this.prisma.$queryRaw<
      { average_expense: string; average_essential: string; months_used: number }[]
    >`SELECT * FROM cost_of_living(${userId}::uuid, 6, NULL)`;

    s.addRow(['Control_Coin — export']);
    s.addRow(['Generated', new Date().toISOString().slice(0, 10)]);
    s.addRow(['Scope', 'all wallets']);
    s.addRow([]);
    s.addRow(['Cost of living (avg / complete month)', Number(col?.average_expense ?? 0)]);
    s.addRow(['  of which essential', Number(col?.average_essential ?? 0)]);
    s.addRow(['Complete months used', Number(col?.months_used ?? 0)]);
    s.getColumn(2).numFmt = 'R$ #,##0.00';
    s.getRow(1).font = { bold: true, size: 14 };
    s.getColumn(1).width = 40;
    s.getColumn(2).width = 18;
    void month;
  }

  private async sheetTransactions(wb: ExcelJS.Workbook, userId: string): Promise<void> {
    const s = wb.addWorksheet('Transactions');
    this.headerize(s, ['date', 'kind', 'description', 'category', 'amount', 'currency', 'split']);

    const rows = await this.prisma.transaction.findMany({
      where: { userId },
      include: { category: true, entries: { include: { account: true, card: true } } },
      orderBy: { occurredOn: 'asc' },
    });

    for (const t of rows) {
      const row = s.addRow({
        date: t.occurredOn,
        kind: t.kind,
        description: t.description ?? '',
        category: t.category?.name ?? 'Uncategorized',
        currency: t.currency,
        split: t.entries.map((e) => `${e.card?.name ?? e.account?.name} ${e.amount.toFixed(2)}`).join(' / '),
      });
      this.moneyCell(row.getCell('amount'), t.totalAmount.toFixed(2));
      row.getCell('date').numFmt = 'yyyy-mm-dd';
    }
  }

  private async sheetSettlements(wb: ExcelJS.Workbook, userId: string): Promise<void> {
    const s = wb.addWorksheet('Settlements');
    this.headerize(s, ['purchased', 'description', 'source', 'part', 'due', 'amount', 'settled']);

    const rows = await this.prisma.$queryRaw<
      {
        occurred_on: Date;
        description: string | null;
        source: string;
        due_on: Date;
        sequence_no: number;
        installment_count: number;
        amount: { toFixed(n: number): string };
        settled: boolean;
      }[]
    >`
      SELECT t.occurred_on, t.description, COALESCE(c.name, a.name) AS source,
             s.due_on, s.sequence_no, e.installment_count, s.amount,
             (s.settled_on IS NOT NULL) AS settled
        FROM settlement s
        JOIN entry e ON e.id = s.entry_id
        JOIN transaction t ON t.id = e.transaction_id
        LEFT JOIN card c ON c.id = e.card_id
        LEFT JOIN account a ON a.id = e.account_id
       WHERE t.user_id = ${userId}::uuid ORDER BY s.due_on ASC`;

    for (const r of rows) {
      const row = s.addRow({
        purchased: r.occurred_on,
        description: r.description ?? '',
        source: r.source,
        part: r.installment_count > 1 ? `${r.sequence_no}/${r.installment_count}` : '1/1',
        due: r.due_on,
        settled: r.settled ? 'yes' : 'no',
      });
      this.moneyCell(row.getCell('amount'), r.amount.toFixed(2));
      row.getCell('purchased').numFmt = 'yyyy-mm-dd';
      row.getCell('due').numFmt = 'yyyy-mm-dd';
    }
  }

  private async sheetCategories(wb: ExcelJS.Workbook, userId: string): Promise<void> {
    const s = wb.addWorksheet('Categories');
    this.headerize(s, ['name', 'parent', 'essential', 'target']);
    const rows = await this.prisma.category.findMany({
      where: { userId, archived: false },
      include: { parent: true },
      orderBy: { name: 'asc' },
    });
    for (const c of rows) {
      const row = s.addRow({
        name: c.name,
        parent: c.parent?.name ?? '',
        essential: c.isEssential ? 'yes' : 'no',
      });
      if (c.monthlyTarget) this.moneyCell(row.getCell('target'), c.monthlyTarget.toFixed(2));
    }
  }

  private async sheetAccounts(wb: ExcelJS.Workbook, userId: string): Promise<void> {
    const s = wb.addWorksheet('Accounts');
    this.headerize(s, ['wallet', 'account', 'card', 'functions', 'balance']);
    const balances = await this.prisma.$queryRaw<{ account_id: string; balance: string }[]>`
      SELECT account_id::text, balance::text FROM v_account_balance WHERE user_id = ${userId}::uuid`;
    const accounts = await this.prisma.account.findMany({
      where: { userId, archived: false },
      include: { wallet: true, cards: true },
      orderBy: { name: 'asc' },
    });
    for (const a of accounts) {
      const bal = balances.find((b) => b.account_id === a.id)?.balance ?? '0';
      const row = s.addRow({ wallet: a.wallet?.name ?? '(no wallet)', account: a.name });
      this.moneyCell(row.getCell('balance'), Number(bal).toFixed(2));
      for (const c of a.cards) {
        s.addRow({
          account: `  ↳ ${a.name}`,
          card: c.name,
          functions: [c.allowsCredit && 'credit', c.allowsDebit && 'debit'].filter(Boolean).join('+'),
        });
      }
    }
  }

  // ── Import: read safely, per BR26 ────────────────────────────────────────

  async import(
    userId: string,
    accountId: string,
    buffer: Buffer,
    sheetName?: string,
  ): Promise<{
    imported: number;
    duplicates: number;
    errors: number;
    batchId: string;
    sheet: string;
    locale: string;
    categoriesCreated: string[];
  }> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new DomainError(ERROR_CODES.NOT_FOUND, 'account not found');

    const wb = new ExcelJS.Workbook();
    try {
      await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      // BR26 alt 2b: .xls, password-protected, or corrupt.
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'não foi possível ler o arquivo — salve como .xlsx ou CSV');
    }

    const sheet =
      (sheetName && wb.getWorksheet(sheetName)) ?? wb.worksheets[0];
    if (!sheet) throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'planilha vazia');

    const { headerRow, columns } = detectHeader(sheet);
    if (!columns) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'não encontrei colunas de data, valor e descrição');
    }

    const categories = await categoryMatcher(this.prisma, userId);
    const batch = await this.prisma.importBatch.create({
      data: { userId, sourceFormat: 'XLSX', fileName: 'upload.xlsx', sheetName: sheet.name },
    });

    let imported = 0;
    let duplicates = 0;
    let errors = 0;
    let localeSeen = 'unknown';

    for (let r = headerRow + 1; r <= sheet.rowCount; r += 1) {
      const row = sheet.getRow(r);
      if (isBlank(row)) continue;

      const descCell = row.getCell(columns.description);
      const description = cellText(descCell).trim();
      // BR26: a trailing totals row is excluded, not imported.
      if (/^(total|totais?|saldo)/i.test(description)) continue;

      let amount: Money;
      let date: string;
      let sign: number;
      try {
        const parsed = readAmount(row.getCell(columns.amount));
        amount = parsed.amount;
        sign = parsed.sign;
        localeSeen = parsed.locale;
        date = readDate(row.getCell(columns.date));
      } catch {
        errors += 1; // no cached value, or unreadable cell
        continue;
      }

      const externalRef = createHash('sha256')
        .update(`${accountId}|${date}|${amount}|${description}`)
        .digest('hex')
        .slice(0, 32);

      if (await this.prisma.transaction.findFirst({ where: { userId, externalRef } })) {
        duplicates += 1; // BR24: skipped, never merged
        continue;
      }

      const isIncome = sign >= 0;
      await this.transactions.create(userId, {
        kind: isIncome ? 'INCOME' : 'EXPENSE',
        occurrenceType: 'OCCASIONAL',
        categoryId: columns.category ? await categories.resolve(cellText(row.getCell(columns.category))) : null,
        description,
        occurredOn: date,
        totalAmount: amount,
        currency: account.currency,
        entries: [{ side: isIncome ? 'DESTINATION' : 'SOURCE', accountId, amount }],
      });
      await this.prisma.$executeRaw`
        UPDATE transaction SET external_ref = ${externalRef}, import_batch_id = ${batch.id}::uuid
         WHERE user_id = ${userId}::uuid AND external_ref IS NULL
           AND occurred_on = ${date}::date AND total_amount = ${amount}::numeric
           AND description = ${description}`;
      imported += 1;
    }

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { rowCount: imported, errorCount: errors, numberLocale: localeSeen },
    });

    return { imported, duplicates, errors, batchId: batch.id, sheet: sheet.name, locale: localeSeen, categoriesCreated: categories.created };
  }
}

// ── Cell reading helpers ────────────────────────────────────────────────────

const HEADER_HINTS = {
  date: /^(data|date|dt)/i,
  amount: /^(valor|amount|montante|value)/i,
  description: /^(descri|desc|hist|memo|lançamento|lancamento)/i,
  category: /^(categoria|category)/i,
};

/** Detect the header row rather than assuming it is row 1 (BR26). */
function detectHeader(
  sheet: ExcelJS.Worksheet,
): { headerRow: number; columns: { date: number; amount: number; description: number; category: number } | null } {
  for (let r = 1; r <= Math.min(sheet.rowCount, 12); r += 1) {
    const row = sheet.getRow(r);
    let date = 0;
    let amount = 0;
    let description = 0;
    let category = 0;
    row.eachCell((cell, col) => {
      const text = cellText(cell);
      if (!date && HEADER_HINTS.date.test(text)) date = col;
      if (!amount && HEADER_HINTS.amount.test(text)) amount = col;
      if (!description && HEADER_HINTS.description.test(text)) description = col;
      if (!category && HEADER_HINTS.category.test(text)) category = col;
    });
    if (date && amount && description) return { headerRow: r, columns: { date, amount, description, category } };
  }
  return { headerRow: 1, columns: null };
}

export function isBlank(row: ExcelJS.Row): boolean {
  let hasValue = false;
  row.eachCell({ includeEmpty: false }, (cell) => {
    if (cellText(cell).trim() !== '') hasValue = true;
  });
  return !hasValue;
}

/** The displayed text of a cell, taking a formula's cached result (BR26). */
export function cellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && 'formula' in v) {
    // A formula: use the cached result only, never recompute.
    const result = (v as { result?: unknown }).result;
    if (result === undefined) throw new Error('formula with no cached value');
    return String(result);
  }
  if (typeof v === 'object' && 'richText' in v) {
    return (v as { richText: { text: string }[] }).richText.map((t) => t.text).join('');
  }
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/**
 * Read an amount from its displayed string, parsed to exact decimal — never
 * through the cell's float. Infers the locale from the separators (BR26).
 */
export function readAmount(cell: ExcelJS.Cell): { amount: Money; sign: number; locale: string } {
  const raw = cellText(cell).replace(/[R$\s]/g, '').trim();
  if (raw === '') throw new Error('empty amount');

  const sign = raw.startsWith('-') || raw.startsWith('(') ? -1 : 1;
  const digits = raw.replace(/[()+-]/g, '');

  const lastComma = digits.lastIndexOf(',');
  const lastDot = digits.lastIndexOf('.');
  let normalised: string;
  let locale: string;
  if (lastComma > lastDot) {
    normalised = digits.replace(/\./g, '').replace(',', '.'); // 1.234,56 → pt-BR
    locale = 'pt-BR';
  } else {
    normalised = digits.replace(/,/g, ''); // 1,234.56 → en
    locale = digits.includes(',') ? 'en' : 'plain';
  }
  return { amount: money(normalised), sign, locale };
}

/** exceljs converts a serial to a Date using the workbook's date system (BR26). */
export function readDate(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const text = cellText(cell).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  const br = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  throw new Error(`unreadable date: ${text}`);
}
