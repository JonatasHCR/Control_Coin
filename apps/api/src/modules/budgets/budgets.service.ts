import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../database/prisma.service.js';

/**
 * Budgets (UC05).
 *
 * A budget is a per-period limit that alerts — distinct from a category target,
 * which is a standing monthly expectation that forecasts (BR20), and from a
 * savings goal, which tracks a balance (BR15). Three questions, three things.
 *
 * BR23: a budget with no explicit limit inherits its category's target, so the
 * user never types the same number twice. The effective limit is
 * COALESCE(limit_amount, monthly_target), computed here on read.
 */
@Injectable()
export class BudgetsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Budgets for a month, each with its consumption and effective limit. */
  async list(userId: string, month: string) {
    const periodStart = `${month}-01`;

    const budgets = await this.prisma.budget.findMany({
      where: { userId, periodType: 'MONTHLY', periodStart: new Date(periodStart) },
      include: { category: { select: { name: true, monthlyTarget: true, isEssential: true } } },
      orderBy: { category: { name: 'asc' } },
    });

    // BR12: a split expense consumes the budget once, for the full total.
    // BR14: a credit purchase consumes in its purchase month, not payment month.
    const spent = await this.prisma.$queryRaw<{ category_id: string; total: unknown }[]>`
      SELECT t.category_id::text, SUM(s.amount) AS total
        FROM settlement s
        JOIN entry e       ON e.id = s.entry_id
        JOIN transaction t ON t.id = e.transaction_id
       WHERE t.user_id = ${userId}::uuid AND t.kind = 'EXPENSE' AND e.side = 'SOURCE'
         AND settlement_competence_month(s.invoice_id, s.due_on, t.occurred_on, s.sequence_no) = ${periodStart}::date
       GROUP BY t.category_id`;

    const spentOf = (categoryId: string): string =>
      Number(String(spent.find((r) => r.category_id === categoryId)?.total ?? 0)).toFixed(2);

    return budgets.map((b) => {
      const limit = b.limitAmount ?? b.category.monthlyTarget; // BR23
      const consumed = spentOf(b.categoryId);
      const limitStr = limit?.toFixed(2) ?? null;
      const percent =
        limit && Number(limit) > 0 ? Math.round((Number(consumed) / Number(limit)) * 100) : null;

      return {
        id: b.id,
        categoryId: b.categoryId,
        name: b.category.name,
        isEssential: b.category.isEssential,
        limit: limitStr,
        inheritsTarget: b.limitAmount === null, // shows the user where the number came from
        consumed,
        percent,
        // UC05 alt flow: ≥ 80% is the alert threshold, over is the overrun.
        state: percent === null ? 'none' : percent > 100 ? 'over' : percent >= 80 ? 'warn' : 'ok',
      };
    });
  }

  create(
    userId: string,
    input: { categoryId: string; periodStart: string; limitAmount?: string | null; currency?: string },
  ) {
    return this.prisma.budget.create({
      data: {
        userId,
        categoryId: input.categoryId,
        periodType: 'MONTHLY',
        periodStart: new Date(input.periodStart),
        limitAmount: input.limitAmount ?? null, // BR23: null inherits the target
        currency: input.currency ?? 'BRL',
      },
    });
  }

  /** Change the limit — or clear it to inherit the category target again (BR23). */
  async update(userId: string, id: string, limitAmount: string | null) {
    const { count } = await this.prisma.budget.updateMany({
      where: { id, userId },
      data: { limitAmount },
    });
    return { updated: count };
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.budget.deleteMany({ where: { id, userId } });
    return { deleted: count };
  }
}
