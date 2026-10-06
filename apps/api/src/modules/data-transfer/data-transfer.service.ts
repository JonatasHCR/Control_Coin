import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { money, type Money } from '@cc/domain/money';
import { ERROR_CODES } from '@cc/domain/rules';

import { DomainError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';
import { categoryMatcher } from './category-matcher.js';

/**
 * Import and export (UC09).
 *
 * CSV is the lowest common denominator the docs name — one level per file, and
 * the safest. Money crosses as a string throughout; nothing here parses an
 * amount through a float (BR26/BR36).
 *
 * XLSX is the documented richer path (two levels in one workbook, the four
 * spreadsheet hazards) and is deliberately left for a follow-up — this covers
 * the core: BR24 dedup on import, BR25 two levels on export.
 */
@Injectable()
export class DataTransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
  ) {}

  /** BR25: export at transaction level or settlement level. */
  async exportCsv(userId: string, level: 'transaction' | 'settlement'): Promise<string> {
    return level === 'settlement'
      ? this.exportSettlements(userId)
      : this.exportTransactions(userId);
  }

  private async exportTransactions(userId: string): Promise<string> {
    const rows = await this.prisma.transaction.findMany({
      where: { userId },
      include: { category: true, entries: { include: { account: true, card: true } } },
      orderBy: { occurredOn: 'asc' },
    });

    const header = ['date', 'kind', 'description', 'category', 'amount', 'currency', 'split'];
    const lines = rows.map((t) =>
      csvRow([
        t.occurredOn.toISOString().slice(0, 10),
        t.kind,
        t.description ?? '',
        t.category?.name ?? 'Uncategorized', // BR01: shown, never blank
        t.totalAmount.toFixed(2),
        t.currency,
        // A split is summarised in one column so nothing is silently lost.
        t.entries.map((e) => `${e.card?.name ?? e.account?.name} ${e.amount.toFixed(2)}`).join(' / '),
      ]),
    );
    return preamble('transaction', rows.length) + [csvRow(header), ...lines].join('\n');
  }

  private async exportSettlements(userId: string): Promise<string> {
    const rows = await this.prisma.$queryRaw<
      {
        occurred_on: Date;
        description: string | null;
        source: string;
        due_on: Date;
        sequence_no: number;
        installment_count: number;
        amount: Prisma.Decimal;
        settled: boolean;
      }[]
    >`
      SELECT t.occurred_on, t.description,
             COALESCE(c.name, a.name)          AS source,
             s.due_on, s.sequence_no, e.installment_count, s.amount,
             (s.settled_on IS NOT NULL)         AS settled
        FROM settlement s
        JOIN entry e       ON e.id = s.entry_id
        JOIN transaction t ON t.id = e.transaction_id
        LEFT JOIN card c   ON c.id = e.card_id
        LEFT JOIN account a ON a.id = e.account_id
       WHERE t.user_id = ${userId}::uuid
       ORDER BY s.due_on ASC`;

    const header = ['purchased', 'description', 'source', 'part', 'due', 'amount', 'settled'];
    const lines = rows.map((r) =>
      csvRow([
        r.occurred_on.toISOString().slice(0, 10),
        r.description ?? '',
        r.source,
        r.installment_count > 1 ? `${r.sequence_no}/${r.installment_count}` : '1/1',
        r.due_on.toISOString().slice(0, 10),
        r.amount.toFixed(2),
        r.settled ? 'yes' : 'no',
      ]),
    );
    return preamble('settlement', rows.length) + [csvRow(header), ...lines].join('\n');
  }

  /**
   * BR24: import CSV into a chosen account, deduplicating on an external
   * reference derived from the row. A duplicate is skipped, never merged.
   * Rows land Uncategorized — a statement never says what a purchase was for.
   */
  async importCsv(
    userId: string,
    accountId: string,
    csv: string,
    columns: { date: number; amount: number; description: number; category?: number | undefined },
  ): Promise<{ imported: number; duplicates: number; errors: number; batchId: string; categoriesCreated: string[] }> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new DomainError(ERROR_CODES.NOT_FOUND, 'account not found');

    const batch = await this.prisma.importBatch.create({
      data: { userId, sourceFormat: 'CSV', fileName: 'upload.csv' },
    });

    const dataRows = parseCsv(csv).slice(1); // skip the header
    const categories = await categoryMatcher(this.prisma, userId);
    let imported = 0;
    let duplicates = 0;
    let errors = 0;

    for (const row of dataRows) {
      const rawDate = row[columns.date]?.trim();
      const rawAmount = row[columns.amount]?.trim();
      const description = row[columns.description]?.trim() ?? '';
      if (!rawDate || !rawAmount) {
        errors += 1;
        continue;
      }

      let amount: Money;
      let date: string;
      try {
        amount = parseAmount(rawAmount);
        date = normaliseDate(rawDate);
      } catch {
        errors += 1;
        continue;
      }

      // The dedup key: same account, date, amount and description → same row.
      const externalRef = createHash('sha256')
        .update(`${accountId}|${date}|${amount}|${description}`)
        .digest('hex')
        .slice(0, 32);

      const existing = await this.prisma.transaction.findFirst({
        where: { userId, externalRef },
      });
      if (existing) {
        duplicates += 1; // BR24: skipped, never merged
        continue;
      }

      // A positive amount is income, negative is expense — the statement's sign.
      const isIncome = !rawAmount.startsWith('-');
      const abs = amount.replace('-', '') as Money;

      await this.transactions.create(userId, {
        kind: isIncome ? 'INCOME' : 'EXPENSE',
        occurrenceType: 'OCCASIONAL',
        // BR01: a statement rarely says what a purchase was for; when the
        // user maps a category column, it does.
        categoryId: columns.category === undefined ? null : await categories.resolve(row[columns.category]),
        description,
        occurredOn: date,
        totalAmount: abs,
        currency: account.currency,
        entries: [{ side: isIncome ? 'DESTINATION' : 'SOURCE', accountId, amount: abs }],
      });

      // Stamp the ref so a re-import of the same file skips it.
      await this.prisma.transaction.updateMany({
        where: { userId, externalRef: null, occurredOn: new Date(date), totalAmount: new Prisma.Decimal(abs), description },
        data: { externalRef, importBatchId: batch.id },
      });
      imported += 1;
    }

    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { rowCount: imported, errorCount: errors },
    });

    return { imported, duplicates, errors, batchId: batch.id, categoriesCreated: categories.created };
  }

  /**
   * The same CSV as previstos (BR40): pending plans on the chosen account, the
   * sign deciding expense or income. A plan already there (same kind,
   * description, amount, date) is a duplicate; the n-th identical row in the
   * file is new only if fewer than n exist.
   */
  async importCsvPlanned(
    userId: string,
    accountId: string,
    csv: string,
    columns: { date: number; amount: number; description: number; category?: number | undefined },
    notifyDaysBefore: number,
  ): Promise<{ imported: number; duplicates: number; errors: number; categoriesCreated: string[] }> {
    const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
    if (!account) throw new DomainError(ERROR_CODES.NOT_FOUND, 'account not found');

    const categories = await categoryMatcher(this.prisma, userId);
    const key = (kind: string, description: string, amount: string, date: string) =>
      [kind, description.trim().toLowerCase(), amount, date].join('|');
    const existing = new Map<string, number>();
    for (const p of await this.prisma.plannedTransaction.findMany({ where: { userId } })) {
      const k = key(p.kind, p.description, p.amount.toFixed(2), p.expectedOn.toISOString().slice(0, 10));
      existing.set(k, (existing.get(k) ?? 0) + 1);
    }
    const seen = new Map<string, number>();
    let imported = 0;
    let duplicates = 0;
    let errors = 0;

    for (const row of parseCsv(csv).slice(1)) {
      const rawAmount = row[columns.amount]?.trim() ?? '';
      let amount: Money;
      let date: string;
      try {
        amount = parseAmount(rawAmount).replace('-', '') as Money;
        date = normaliseDate(row[columns.date]?.trim() ?? '');
        if (Number(amount) <= 0) throw new Error();
      } catch {
        errors += 1;
        continue;
      }
      const kind = rawAmount.startsWith('-') ? 'EXPENSE' : 'INCOME';
      const description = row[columns.description]?.trim() || (kind === 'EXPENSE' ? 'Despesa prevista' : 'Receita prevista');

      const k = key(kind, description, amount, date);
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      if ((existing.get(k) ?? 0) >= n) {
        duplicates += 1;
        continue;
      }

      await this.prisma.plannedTransaction.create({
        data: {
          userId,
          kind,
          description,
          amount,
          currency: account.currency,
          expectedOn: new Date(date),
          accountId,
          categoryId: columns.category === undefined ? null : await categories.resolve(row[columns.category]),
          notifyDaysBefore,
        },
      });
      imported += 1;
    }

    return { imported, duplicates, errors, categoriesCreated: categories.created };
  }
}

// ── CSV helpers ─────────────────────────────────────────────────────────────

function preamble(level: string, count: number): string {
  return `# Control_Coin export · level=${level} · rows=${count} · generated=${new Date().toISOString().slice(0, 10)}\n`;
}

function csvRow(cells: string[]): string {
  return cells
    .map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c))
    .join(',');
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.startsWith('#'))
    .map((line) => {
      const cells: string[] = [];
      let cur = '';
      let quoted = false;
      for (let i = 0; i < line.length; i += 1) {
        const ch = line[i];
        if (quoted) {
          if (ch === '"' && line[i + 1] === '"') {
            cur += '"';
            i += 1;
          } else if (ch === '"') {
            quoted = false;
          } else {
            cur += ch;
          }
        } else if (ch === '"') {
          quoted = true;
        } else if (ch === ',') {
          cells.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      cells.push(cur);
      return cells;
    });
}

/** Parse an amount without ever touching a float (BR26). */
function parseAmount(raw: string): Money {
  const cleaned = raw.replace(/[R$\s]/g, '');
  // Accept both 1.234,56 (pt-BR) and 1234.56 by normalising the last separator.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalised: string;
  if (lastComma > lastDot) {
    normalised = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalised = cleaned.replace(/,/g, '');
  }
  return money(normalised);
}

function normaliseDate(raw: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  throw new Error(`unrecognised date: ${raw}`);
}
