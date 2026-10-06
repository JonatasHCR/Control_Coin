import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../database/prisma.service.js';

/**
 * In-app notifications (UC08).
 *
 * BR28: nothing is ever sent out of the system — no channel, no email, no push.
 * A notification is a row the user reads on their next visit. Its behaviours
 * are what make a centre usable rather than a log:
 *
 *  - a condition that persists UPDATES one row, it does not raise a new one
 *    daily (the partial unique index enforces one live row per rule+subject);
 *  - a condition that clears before it is read is WITHDRAWN;
 *  - overdue invoices notify with no rule and no off switch — an unpaid card is
 *    not a preference (BR32).
 */
const KIND_LABEL: Record<string, string> = { EXPENSE: 'Despesa', INCOME: 'Receita', TRANSFER: 'Transferência' };

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Unread first, newest first — the notification centre. */
  async list(userId: string) {
    const rows = await this.prisma.notification.findMany({
      where: { userId, withdrawnAt: null, dismissedAt: null },
      orderBy: [{ readAt: { sort: 'asc', nulls: 'first' } }, { raisedAt: 'desc' }],
      take: 50,
    });
    return rows.map((n) => ({
      id: n.id,
      type: n.type,
      message: n.message,
      raisedAt: n.raisedAt.toISOString(),
      read: n.readAt !== null,
      href: n.subjectType === 'PLANNED' ? `/planned#${n.subjectId}` : n.subjectType === 'INVOICE' ? '/invoices' : null,
    }));
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null, withdrawnAt: null, dismissedAt: null },
    });
  }

  markRead(userId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  markAllRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, readAt: null, withdrawnAt: null },
      data: { readAt: new Date() },
    });
  }

  dismiss(userId: string, id: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { dismissedAt: new Date() },
    });
  }

  /**
   * Raise a notification for a subject, or escalate the live one's text. Returns
   * true only when a new row was created (so callers can count it).
   *
   * Two rules make the centre behave like a person expects:
   *  - one live row per subject — the same condition never stacks up daily;
   *  - a dismissal is respected — the *same* message the user cleared is not
   *    re-raised on the next evaluation. A changed message (the situation
   *    escalated: fewer days left, a higher percentage) is a new notice.
   */
  private async raiseOrUpdate(input: {
    userId: string;
    type: string;
    subjectType: string;
    subjectId: string;
    message: string;
    alertRuleId?: string;
  }): Promise<boolean> {
    const live = await this.prisma.notification.findFirst({
      where: { userId: input.userId, type: input.type, subjectId: input.subjectId, withdrawnAt: null, dismissedAt: null },
    });
    if (live) {
      if (live.message !== input.message) {
        await this.prisma.notification.update({ where: { id: live.id }, data: { message: input.message } });
      }
      return false;
    }

    const dismissed = await this.prisma.notification.findFirst({
      where: { userId: input.userId, type: input.type, subjectId: input.subjectId, dismissedAt: { not: null }, message: input.message },
    });
    if (dismissed) return false;

    await this.prisma.notification.create({
      data: {
        userId: input.userId,
        alertRuleId: input.alertRuleId ?? null,
        type: input.type,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        message: input.message,
      },
    });
    return true;
  }

  /**
   * Evaluate the conditions and raise, update or withdraw notifications. Run by
   * the daily job; exposed so a test and a manual refresh can drive it with the
   * clock injected (ARCH02). Idempotent — running twice changes nothing.
   */
  async evaluate(userId: string, today: string): Promise<{ raised: number; withdrawn: number }> {
    let raised = 0;
    let withdrawn = 0;

    // Overdue invoices — the one alert that is never opt-in (BR32).
    const overdue = await this.prisma.$queryRaw<
      { invoice_id: string; card_name: string; open_amount: unknown; days_overdue: number }[]
    >`
      SELECT v.invoice_id::text, c.name AS card_name, v.open_amount, v.days_overdue
        FROM v_invoice_total v
        JOIN card c    ON c.id = v.card_id
        JOIN account a ON a.id = c.account_id
       WHERE a.user_id = ${userId}::uuid AND v.is_overdue`;

    for (const inv of overdue) {
      const open = Number(String(inv.open_amount)).toFixed(2);
      const message = `Fatura ${inv.card_name} ${inv.days_overdue} dias em atraso — R$ ${open} em aberto`;
      if (await this.raiseOrUpdate({
        userId, type: 'INVOICE_OVERDUE', subjectType: 'INVOICE', subjectId: inv.invoice_id, message,
      })) raised += 1;
    }

    // Withdraw overdue notifications whose invoice is no longer overdue.
    const stillOverdue = new Set(overdue.map((o) => o.invoice_id));
    const live = await this.prisma.notification.findMany({
      where: { userId, type: 'INVOICE_OVERDUE', withdrawnAt: null, dismissedAt: null },
    });
    for (const n of live) {
      if (n.subjectId && !stillOverdue.has(n.subjectId)) {
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { withdrawnAt: new Date() },
        });
        withdrawn += 1;
      }
    }

    // Budget thresholds — raised only where the user created a rule (UC08).
    const rules = await this.prisma.alertRule.findMany({
      where: { userId, type: 'BUDGET_THRESHOLD', active: true },
    });
    for (const rule of rules) {
      if (!rule.targetId || rule.thresholdPercent === null) continue;
      const month = `${today.slice(0, 7)}-01`;
      const [row] = await this.prisma.$queryRaw<{ name: string; percent: number | null }[]>`
        SELECT c.name,
               CASE WHEN COALESCE(b.limit_amount, c.monthly_target) > 0
                    THEN ROUND(100 * COALESCE(spent.total, 0)
                               / COALESCE(b.limit_amount, c.monthly_target))::int
                    ELSE NULL END AS percent
          FROM category c
          LEFT JOIN budget b ON b.category_id = c.id AND b.period_start = ${month}::date
          LEFT JOIN (
            SELECT t.category_id, SUM(s.amount) AS total
              FROM settlement s JOIN entry e ON e.id = s.entry_id
              JOIN transaction t ON t.id = e.transaction_id
             WHERE t.kind = 'EXPENSE' AND e.side = 'SOURCE'
               AND settlement_competence_month(s.invoice_id, s.due_on) = ${month}::date
             GROUP BY t.category_id
          ) spent ON spent.category_id = c.id
         WHERE c.id = ${rule.targetId}::uuid`;

      if (row?.percent !== null && row?.percent !== undefined && row.percent >= rule.thresholdPercent) {
        const message = `${row.name} atingiu ${row.percent}% do orçamento`;
        if (await this.raiseOrUpdate({
          userId, alertRuleId: rule.id, type: 'BUDGET_THRESHOLD', subjectType: 'BUDGET', subjectId: rule.targetId, message,
        })) raised += 1;
      }
    }

    // Upcoming invoice due dates — opt-in, raised N days before the due date
    // (UC08). Overdue is unconditional (above); this is the reminder *before*
    // it becomes overdue, and the window is what the user configured.
    const dueRules = await this.prisma.alertRule.findMany({
      where: { userId, type: 'INVOICE_DUE', active: true },
    });
    const dueSoon = new Set<string>();
    for (const rule of dueRules) {
      const days = rule.daysBefore ?? 5;
      const upcoming = await this.prisma.$queryRaw<
        { invoice_id: string; card_name: string; open_amount: unknown; days_until: number }[]
      >`
        SELECT v.invoice_id::text, c.name AS card_name, v.open_amount,
               (v.due_on - ${today}::date) AS days_until
          FROM v_invoice_total v
          JOIN card c    ON c.id = v.card_id
          JOIN account a ON a.id = c.account_id
         WHERE a.user_id = ${userId}::uuid
           AND v.open_amount > 0
           AND NOT v.is_overdue
           AND v.due_on >= ${today}::date
           AND v.due_on <= (${today}::date + ${days}::int)
           ${rule.targetId ? Prisma.sql`AND c.id = ${rule.targetId}::uuid` : Prisma.empty}`;

      for (const inv of upcoming) {
        dueSoon.add(inv.invoice_id);
        const open = Number(String(inv.open_amount)).toFixed(2);
        const left = Number(inv.days_until);
        const message =
          left === 0
            ? `Fatura ${inv.card_name} vence hoje — R$ ${open} em aberto`
            : `Fatura ${inv.card_name} vence em ${left} dia(s) — R$ ${open} em aberto`;

        if (await this.raiseOrUpdate({
          userId, alertRuleId: rule.id, type: 'INVOICE_DUE_SOON', subjectType: 'INVOICE', subjectId: inv.invoice_id, message,
        })) raised += 1;
      }
    }

    // Withdraw due-soon notices that no longer apply — paid, now overdue (the
    // overdue alert takes over), or past the configured window.
    const liveDue = await this.prisma.notification.findMany({
      where: { userId, type: 'INVOICE_DUE_SOON', withdrawnAt: null, dismissedAt: null },
    });
    for (const n of liveDue) {
      if (n.subjectId && !dueSoon.has(n.subjectId)) {
        await this.prisma.notification.update({
          where: { id: n.id },
          data: { withdrawnAt: new Date() },
        });
        withdrawn += 1;
      }
    }

    // BR40 — planned transactions ask to be confirmed from their reminder
    // window on, and keep asking while unresolved. Not opt-in: the user asked
    // for the reminder when they set the plan.
    const planned = await this.prisma.$queryRaw<
      { id: string; kind: string; description: string; amount: unknown; days_until: number }[]
    >`
      SELECT id::text, kind, description, amount, (expected_on - ${today}::date) AS days_until
        FROM planned_transaction
       WHERE user_id = ${userId}::uuid AND status = 'PENDING'
         AND expected_on - notify_days_before <= ${today}::date`;
    const plannedLive = new Set<string>();
    for (const p of planned) {
      plannedLive.add(p.id);
      const value = Number(String(p.amount)).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      const what = `${KIND_LABEL[p.kind] ?? p.kind} "${p.description}" (${value})`;
      const left = Number(p.days_until);
      const message =
        left > 0
          ? `${what} prevista para daqui a ${left} dia(s) — confirme quando acontecer`
          : left === 0
            ? `${what} prevista para hoje — aconteceu? Confirme`
            : `${what} prevista há ${-left} dia(s) — aconteceu? Confirme ou marque que não aconteceu`;
      if (await this.raiseOrUpdate({ userId, type: 'PLANNED_DUE', subjectType: 'PLANNED', subjectId: p.id, message })) raised += 1;
    }
    const livePlanned = await this.prisma.notification.findMany({
      where: { userId, type: 'PLANNED_DUE', withdrawnAt: null, dismissedAt: null },
    });
    for (const n of livePlanned) {
      if (n.subjectId && !plannedLive.has(n.subjectId)) {
        await this.prisma.notification.update({ where: { id: n.id }, data: { withdrawnAt: new Date() } });
        withdrawn += 1;
      }
    }

    return { raised, withdrawn };
  }
  // ── Alert-rule CRUD (UC08) ──────────────────────────────────────────────

  listRules(userId: string) {
    return this.prisma.alertRule.findMany({ where: { userId }, orderBy: { type: 'asc' } });
  }

  createRule(
    userId: string,
    input: { type: string; targetType?: string | null; targetId?: string | null; thresholdPercent?: number | null; daysBefore?: number | null },
  ) {
    // BR28: no channel — the notification centre is the only destination.
    return this.prisma.alertRule.create({
      data: {
        userId,
        type: input.type,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        thresholdPercent: input.thresholdPercent ?? null,
        daysBefore: input.daysBefore ?? null,
      },
    });
  }

  async updateRule(userId: string, id: string, patch: { thresholdPercent?: number | null; daysBefore?: number | null; active?: boolean }) {
    const { count } = await this.prisma.alertRule.updateMany({ where: { id, userId }, data: patch });
    return { updated: count };
  }

  async removeRule(userId: string, id: string) {
    const { count } = await this.prisma.alertRule.deleteMany({ where: { id, userId } });
    return { deleted: count };
  }
}
