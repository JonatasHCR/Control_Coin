import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';

import { PrismaService } from '../../database/prisma.service.js';
import { ReportsRepository } from './reports.repository.js';

const INK = '#1f2328';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const ACCENT = '#1d6a85'; // the app's petrol accent
const GOOD = '#15803d';
const BAD = '#b91c1c';

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

const brl = (v: string | number) =>
  Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const brDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');

/** A financial summary for a month or any date range, as PDF (UC07). */
@Injectable()
export class SummaryPdfService {
  constructor(
    private readonly reports: ReportsRepository,
    private readonly prisma: PrismaService,
  ) {}

  /** `from` and `to` are inclusive ISO dates (YYYY-MM-DD). */
  async render(userId: string, from: string, to: string): Promise<Buffer> {
    const months = wholeMonths(from, to);
    const [balanceRows, monthly, col, categories, targets, invoices, debts, accounts, top, cards] = await Promise.all([
      this.balance(userId, from, to),
      this.monthly(userId, from, to),
      this.reports.essentialCost(userId, `${to.slice(0, 7)}-01`, null),
      this.categories(userId, from, to),
      this.prisma.category.findMany({ where: { userId, archived: false, monthlyTarget: { not: null } } }),
      this.reports.invoices(userId, null),
      this.reports.debts(userId),
      this.prisma.$queryRaw<{ wallet: string | null; name: string; type: string; balance: string }[]>`
        SELECT w.name AS wallet, a.name, a.type, b.balance::text AS balance
          FROM account a
          JOIN v_account_balance b ON b.account_id = a.id
          LEFT JOIN wallet w ON w.id = a.wallet_id
         WHERE a.user_id = ${userId}::uuid AND NOT a.archived AND a.type <> 'LIABILITY'
         ORDER BY w.name NULLS LAST, a.name`,
      this.prisma.transaction.findMany({
        where: { userId, kind: 'EXPENSE', occurredOn: { gte: new Date(from), lte: new Date(to) } },
        include: { category: true },
        orderBy: { totalAmount: 'desc' },
        take: 15,
      }),
      this.prisma.card.findMany({ where: { account: { userId } }, select: { id: true, name: true } }),
    ]);
    const b = balanceRows[0]!; // aggregate query: always one row
    // Targets are monthly, so they only compare against whole months.
    const variance = months
      ? targets.map((c) => {
          const target = Number(c.monthlyTarget) * months;
          const actual = Number(categories.find((x) => x.category_id === c.id)?.total ?? 0);
          return { name: c.name, target, actual, variance: target - actual };
        })
      : [];
    const title =
      months === 1 ? `${MONTHS[Number(from.slice(5, 7)) - 1]} de ${from.slice(0, 4)}` : `${brDate(from)} a ${brDate(to)}`;

    const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Resumo financeiro ${title}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;

    // Header
    doc.fillColor(ACCENT).font('Helvetica-Bold').fontSize(20).text('Control Coin', left, 48);
    doc.fillColor(INK).fontSize(14).text(`Resumo financeiro · ${title}`);
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(`Gerado em ${brDate(new Date().toISOString())}`);
    doc.moveDown(1);

    // Despesas are what was SPENT in the period (BR14), not what left the
    // accounts: a credit purchase counts now, though it leaves on payment.
    const spent = categories.reduce((sum, c) => sum + Number(c.total), 0);
    const net = Number(b.income) - spent;
    const tiles: [string, string | number, string][] = [
      ['Receitas', b.income, GOOD],
      ['Despesas', spent, BAD],
      [`Resultado do ${months === 1 ? 'mês' : 'período'}`, net, net < 0 ? BAD : GOOD],
      ['Saldo nas contas no fim', b.closing_balance, Number(b.closing_balance) < 0 ? BAD : INK],
    ];
    const tileW = (width - 3 * 8) / 4;
    const tileY = doc.y;
    tiles.forEach(([label, value, color], i) => {
      const x = left + i * (tileW + 8);
      doc.roundedRect(x, tileY, tileW, 48, 6).fillAndStroke('#f9fafb', RULE);
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(label, x + 10, tileY + 9, { width: tileW - 20 });
      doc.fillColor(color).font('Helvetica-Bold').fontSize(12).text(brl(value), x + 10, tileY + 24, { width: tileW - 20 });
    });
    doc.y = tileY + 60;
    doc.x = left;

    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(
      `Saldo nas contas no início: ${brl(b.opening_balance)} · saiu das contas no período: ${brl(b.expenses)}` +
        (spent > Number(b.expenses) ? ' (compras no crédito só saem quando a fatura é paga)' : ''),
      left,
    );
    // BR14: the essential categories' limits, and the monthly average of all spending to the closing month.
    const endMonth = MONTHS[Number(to.slice(5, 7)) - 1];
    doc.fillColor(MUTED).font('Helvetica').fontSize(9).text(
      `Custo de vida — essencial (soma das metas das categorias essenciais): ${brl(col.month_essential)} · mensal (média de todos os gastos de janeiro a ${endMonth}, ${col.months} ${col.months === 1 ? 'mês' : 'meses'}): ${brl(col.year_average)}`,
    );

    const section = (title: string) => {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.moveDown(1.2);
      doc.x = left;
      doc.fillColor(INK).font('Helvetica-Bold').fontSize(12).text(title);
      const ly = doc.y + 3;
      doc.moveTo(left, ly).lineTo(left + width, ly).strokeColor(RULE).lineWidth(1).stroke();
      doc.y = ly + 6;
    };

    /** Columns as fractions of the width; numbers right-aligned. */
    const table = (cols: { label: string; w: number; right?: boolean }[], rows: { cells: string[]; color?: string }[]) => {
      const draw = (cells: string[], font: string, color: string) => {
        if (doc.y > doc.page.height - 70) doc.addPage();
        const rowY = doc.y;
        let x = left;
        let h = 0;
        cells.forEach((c, i) => {
          const w = cols[i]!.w * width;
          doc.font(font).fontSize(9).fillColor(color)
            .text(c, x + 2, rowY, { width: w - 4, align: cols[i]!.right ? 'right' : 'left' });
          h = Math.max(h, doc.y - rowY);
          x += w;
        });
        doc.y = rowY + h + 3;
      };
      draw(cols.map((c) => c.label), 'Helvetica-Bold', MUTED);
      for (const r of rows) draw(r.cells, 'Helvetica', r.color ?? INK);
      doc.x = left;
    };

    const empty = (text: string) => doc.fillColor(MUTED).font('Helvetica-Oblique').fontSize(9).text(text, left);

    if (monthly.length > 1) {
      section('Evolução mês a mês');
      table(
        [{ label: 'Mês', w: 0.28 }, { label: 'Receitas', w: 0.24, right: true }, { label: 'Despesas', w: 0.24, right: true }, { label: 'Resultado', w: 0.24, right: true }],
        monthly.map((r) => {
          const res = Number(r.income) - Number(r.expenses);
          return {
            cells: [`${MONTHS[Number(r.month.slice(5, 7)) - 1]}/${r.month.slice(0, 4)}`, brl(r.income), brl(r.expenses), brl(res)],
            color: res < 0 ? BAD : INK,
          };
        }),
      );
    }

    // Accounts
    section('Saldos atuais das contas');
    if (accounts.length === 0) empty('Nenhuma conta.');
    else {
      const total = accounts.reduce((s, a) => s + Number(a.balance), 0);
      table(
        [{ label: 'Carteira', w: 0.3 }, { label: 'Conta', w: 0.4 }, { label: 'Saldo', w: 0.3, right: true }],
        [
          ...accounts.map((a) => ({
            cells: [a.wallet ?? '—', a.name, brl(a.balance)],
            color: Number(a.balance) < 0 ? BAD : INK,
          })),
          { cells: ['', 'Total', brl(total)] },
        ],
      );
    }

    // Spending by category, with a bar
    section('Despesas por categoria');
    if (categories.length === 0) empty('Nenhuma despesa no período.');
    else {
      const total = categories.reduce((s, c) => s + Number(c.total), 0);
      const max = Math.max(...categories.map((c) => Number(c.total)));
      for (const c of categories) {
        if (doc.y > doc.page.height - 70) doc.addPage();
        const rowY = doc.y;
        const share = total > 0 ? Number(c.total) / total : 0;
        doc.font('Helvetica').fontSize(9).fillColor(INK)
          .text(`${c.name ?? 'Sem categoria'}${c.is_essential ? ' (essencial)' : ''}`, left, rowY, { width: width * 0.35 });
        const barX = left + width * 0.36;
        const barW = width * 0.34;
        doc.rect(barX, rowY + 2, barW, 7).fill('#f3f4f6');
        doc.rect(barX, rowY + 2, Math.max(1, (barW * Number(c.total)) / max), 7).fill(ACCENT);
        doc.fillColor(MUTED).text(`${(share * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`, left + width * 0.71, rowY, { width: width * 0.1, align: 'right' });
        doc.fillColor(INK).text(brl(c.total), left + width * 0.81, rowY, { width: width * 0.19, align: 'right' });
        doc.y = rowY + 15;
      }
      doc.x = left;
    }

    if (variance.length > 0) {
      section(months === 1 ? 'Metas por categoria' : `Metas por categoria (${months} meses)`);
      table(
        [{ label: 'Categoria', w: 0.4 }, { label: 'Meta', w: 0.2, right: true }, { label: 'Realizado', w: 0.2, right: true }, { label: 'Diferença', w: 0.2, right: true }],
        variance.map((v) => ({
          cells: [v.name, brl(v.target), brl(v.actual), brl(v.variance)],
          color: v.variance < 0 ? BAD : INK,
        })),
      );
    }

    // Largest expenses
    section('Maiores despesas do período');
    if (top.length === 0) empty('Nenhuma despesa no período.');
    else
      table(
        [{ label: 'Data', w: 0.14 }, { label: 'Descrição', w: 0.44 }, { label: 'Categoria', w: 0.24 }, { label: 'Valor', w: 0.18, right: true }],
        top.map((t) => ({
          cells: [brDate(t.occurredOn.toISOString()), t.description ?? '—', t.category?.name ?? 'Sem categoria', brl(t.totalAmount.toFixed(2))],
        })),
      );

    // Open invoices
    section('Faturas em aberto');
    if (invoices.length === 0) empty('Nenhuma fatura em aberto.');
    else
      table(
        [{ label: 'Cartão', w: 0.34 }, { label: 'Vencimento', w: 0.2 }, { label: 'Situação', w: 0.22 }, { label: 'Em aberto', w: 0.24, right: true }],
        invoices.map((i) => ({
          cells: [
            cards.find((c) => c.id === i.card_id)?.name ?? '—',
            brDate(i.due_on),
            i.is_overdue ? `Vencida há ${i.days_overdue} d` : 'A vencer',
            brl(i.open_amount),
          ],
          color: i.is_overdue ? BAD : INK,
        })),
      );

    // Debts
    if (debts.length > 0) {
      section('Dívidas');
      table(
        [{ label: 'Com quem', w: 0.7 }, { label: 'Valor', w: 0.3, right: true }],
        debts.map((d) => ({ cells: [d.name ?? '—', brl(d.total)], color: BAD })),
      );
    }

    // Footer on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0; // writing below the margin would otherwise open a new page
      doc.fillColor(MUTED).font('Helvetica').fontSize(8).text(
        `Control Coin · página ${i + 1} de ${range.count}`,
        left,
        doc.page.height - 32,
        { width, align: 'center', lineBreak: false },
      );
    }

    doc.end();
    return done;
  }
  /**
   * period_balance (BR34/BR35) over a day range: cash basis by settled_on, a
   * charge following whoever paid its invoice, liabilities left out (BR39).
   */
  private balance(userId: string, from: string, to: string) {
    return this.prisma.$queryRaw<{ opening_balance: string; income: string; expenses: string; closing_balance: string }[]>`
      WITH mv AS (${this.movements(userId)})
      SELECT o.opening::text AS opening_balance, x.inc::text AS income, x.exp::text AS expenses,
             (o.opening + x.inc - x.exp)::text AS closing_balance
        FROM (SELECT COALESCE((SELECT SUM(initial_balance) FROM account
                                WHERE user_id = ${userId}::uuid AND type <> 'LIABILITY'), 0)
                   + COALESCE((SELECT SUM(CASE WHEN kind = 'INCOME' THEN amount ELSE -amount END)
                                 FROM mv WHERE d < ${from}::date), 0) AS opening) o,
             (SELECT COALESCE(SUM(amount) FILTER (WHERE kind = 'INCOME'), 0)  AS inc,
                     COALESCE(SUM(amount) FILTER (WHERE kind = 'EXPENSE'), 0) AS exp
                FROM mv WHERE d BETWEEN ${from}::date AND ${to}::date) x`;
  }

  /** Income as received; expenses as spent — the same split as the tiles. */
  private monthly(userId: string, from: string, to: string) {
    return this.prisma.$queryRaw<{ month: string; income: string; expenses: string }[]>`
      WITH mv AS (${this.movements(userId)}), sp AS (${this.spending(userId)})
      SELECT month, SUM(inc)::text AS income, SUM(exp)::text AS expenses
        FROM (SELECT to_char(d, 'YYYY-MM') AS month, amount AS inc, 0 AS exp
                FROM mv WHERE kind = 'INCOME' AND d BETWEEN ${from}::date AND ${to}::date
              UNION ALL
              SELECT to_char(d, 'YYYY-MM'), 0, amount
                FROM sp WHERE d BETWEEN ${from}::date AND ${to}::date) x
       GROUP BY month ORDER BY month`;
  }

  private movements(userId: string) {
    return Prisma.sql`
      SELECT s.settled_on AS d, t.kind, s.amount
        FROM settlement s
        JOIN entry e       ON e.id = s.entry_id
        JOIN transaction t ON t.id = e.transaction_id
        LEFT JOIN account a ON a.id = COALESCE(
               e.account_id,
               (SELECT payer.account_id
                  FROM settlement ps
                  JOIN entry pd    ON pd.id = ps.entry_id AND pd.side = 'DESTINATION'
                  JOIN entry payer ON payer.transaction_id = pd.transaction_id
                                  AND payer.side = 'SOURCE' AND payer.account_id IS NOT NULL
                 WHERE ps.invoice_id = s.invoice_id
                 LIMIT 1),
               (SELECT c.account_id FROM card c WHERE c.id = e.card_id))
       WHERE t.user_id = ${userId}::uuid
         AND s.settled_on IS NOT NULL
         AND t.kind IN ('INCOME', 'EXPENSE')
         AND (a.type IS NULL OR a.type <> 'LIABILITY')`;
  }

  /**
   * BR14 over a day range: a credit installment counts on the purchase date
   * shifted by its sequence (1st on the purchase day, 2nd a month later…);
   * anything else on its settlement date.
   */
  private spending(userId: string) {
    return Prisma.sql`
      SELECT CASE WHEN s.invoice_id IS NULL THEN s.due_on
                  ELSE (t.occurred_on + make_interval(months => s.sequence_no - 1))::date END AS d,
             t.category_id, s.amount
        FROM settlement s
        JOIN entry e       ON e.id = s.entry_id
        JOIN transaction t ON t.id = e.transaction_id
       WHERE t.user_id = ${userId}::uuid AND t.kind = 'EXPENSE' AND e.side = 'SOURCE'`;
  }

  private categories(userId: string, from: string, to: string) {
    return this.prisma.$queryRaw<{ category_id: string | null; name: string | null; is_essential: boolean | null; total: string }[]>`
      WITH sp AS (${this.spending(userId)})
      SELECT c.id::text AS category_id, c.name, c.is_essential, SUM(sp.amount)::text AS total
        FROM sp LEFT JOIN category c ON c.id = sp.category_id
       WHERE sp.d BETWEEN ${from}::date AND ${to}::date
       GROUP BY c.id, c.name, c.is_essential
       ORDER BY SUM(sp.amount) DESC`;
  }
}

/** Number of whole calendar months the range covers exactly, or 0. */
function wholeMonths(from: string, to: string): number {
  const end = new Date(`${to}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  if (!from.endsWith('-01') || end.getUTCDate() !== 1) return 0;
  return (end.getUTCFullYear() - Number(from.slice(0, 4))) * 12 + end.getUTCMonth() + 1 - Number(from.slice(5, 7));
}
