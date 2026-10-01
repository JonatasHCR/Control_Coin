import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { ERROR_CODES } from '@cc/domain/rules';

import { userError } from '../../common/errors/domain-error.js';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import { AuthGuard } from '../../common/guards/auth.guard.js';
import { ReportsRepository } from './reports.repository.js';
import { SummaryPdfService } from './summary-pdf.service.js';

/**
 * Read-only. Every endpoint takes a period and a wallet scope (BR16), and the
 * frontend does the final arithmetic on what these return (ARCH06).
 */
@Controller('reports')
@UseGuards(AuthGuard)
export class ReportsController {
  constructor(
    private readonly reports: ReportsRepository,
    private readonly pdf: SummaryPdfService,
  ) {}

  /** Financial summary as a PDF: `from`+`to` (YYYY-MM-DD), or a `period` month. */
  @Get('summary.pdf')
  async summaryPdf(
    @CurrentUser() userId: string,
    @Res() res: Response,
    @Query('period') period?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const isDate = (d?: string): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
    if (!isDate(from) || !isDate(to)) {
      const p = period && /^\d{4}-\d{2}$/.test(period) ? period : new Date().toISOString().slice(0, 7);
      from = `${p}-01`;
      const end = new Date(`${from}T00:00:00Z`);
      end.setUTCMonth(end.getUTCMonth() + 1, 0);
      to = end.toISOString().slice(0, 10);
    }
    if (from > to) throw userError(ERROR_CODES.VALIDATION_FAILED, 'a data inicial é depois da final');

    const buffer = await this.pdf.render(userId, from, to);
    res
      .status(200)
      .setHeader('Content-Type', 'application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="control-coin-resumo-${from}_${to}.pdf"`)
      .send(buffer);
  }

  /** Everything the dashboard needs for one period, in one round trip. */
  @Get('dashboard')
  async dashboard(
    @CurrentUser() userId: string,
    @Query('period') period?: string,
    @Query('scope') scope?: string,
    @Query('months') months?: string,
  ) {
    const month = `${period ?? new Date().toISOString().slice(0, 7)}-01`;
    const wallets = parseScope(scope);

    const [balance, costOfLiving, categories, variance, invoices, wallets_, debts] =
      await Promise.all([
        this.reports.periodBalance(userId, month, wallets),
        this.reports.costOfLiving(userId, Number(months ?? 6), wallets),
        this.reports.categoryBreakdown(userId, month),
        this.reports.variance(userId, month),
        this.reports.invoices(userId, wallets),
        this.reports.walletBalances(userId),
        this.reports.debts(userId),
      ]);

    return { period: month.slice(0, 7), balance, costOfLiving, categories, variance, invoices, wallets: wallets_, debts };
  }
}

/** BR16: no scope means all wallets. */
function parseScope(scope?: string): string[] | null {
  if (!scope || scope === 'all') return null;
  const ids = scope.split(',').filter((id) => id && id !== 'none');
  return ids.length > 0 ? ids : null;
}
