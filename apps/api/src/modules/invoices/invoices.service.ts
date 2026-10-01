import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { money, sum, type Money } from '@cc/domain/money';
import { ERROR_CODES } from '@cc/domain/rules';

import { Clock } from '../../common/clock/clock.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';

interface InvoiceRow {
  invoice_id: string;
  card_id: string;
  card_name: string;
  reference_month: Date;
  status: string;
  closes_on: Date;
  due_on: Date;
  charged: unknown;
  paid: unknown;
  open_amount: unknown;
  is_overdue: boolean;
  days_overdue: number | string;
}

/**
 * Card invoices and their payment (UC12).
 *
 * BR36: nothing about money is stored on the invoice row — charged, paid, open
 * and overdue are all derived in `v_invoice_total`, so deleting a payment
 * restores the previous state with no correction step.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly clock: Clock,
  ) {}

  async list(userId: string) {
    const rows = await this.prisma.$queryRaw<InvoiceRow[]>`
      SELECT v.invoice_id::text, v.card_id::text, c.name AS card_name,
             v.reference_month, v.status, i.closes_on, v.due_on,
             v.charged, v.paid, v.open_amount, v.is_overdue, v.days_overdue
        FROM v_invoice_total v
        JOIN invoice i  ON i.id = v.invoice_id
        JOIN card c     ON c.id = v.card_id
        JOIN account a  ON a.id = c.account_id
       WHERE a.user_id = ${userId}::uuid
       ORDER BY v.reference_month DESC`;

    return rows.map((r) => ({
      id: r.invoice_id,
      cardId: r.card_id,
      cardName: r.card_name,
      referenceMonth: r.reference_month.toISOString().slice(0, 10),
      closesOn: r.closes_on.toISOString().slice(0, 10),
      dueOn: r.due_on.toISOString().slice(0, 10),
      status: r.is_overdue ? 'OVERDUE' : r.status,
      charged: fixed(r.charged),
      paid: fixed(r.paid),
      openAmount: fixed(r.open_amount),
      isOverdue: r.is_overdue,
      daysOverdue: Number(r.days_overdue),
    }));
  }

  /**
   * Paying an invoice is a **transfer**, never an expense (BR31): the spending
   * counted when each purchase was made. Counting it again here would
   * double-count every credit purchase — the commonest error in these tools.
   */
  async pay(
    userId: string,
    invoiceId: string,
    input: { paidOn: string; sources: { accountId: string; amount: string }[] },
  ) {
    const [invoice] = await this.prisma.$queryRaw<InvoiceRow[]>`
      SELECT v.invoice_id::text, v.card_id::text, c.name AS card_name,
             v.reference_month, v.status, i.closes_on, v.due_on,
             v.charged, v.paid, v.open_amount, v.is_overdue, v.days_overdue
        FROM v_invoice_total v
        JOIN invoice i ON i.id = v.invoice_id
        JOIN card c    ON c.id = v.card_id
        JOIN account a ON a.id = c.account_id
       WHERE v.invoice_id = ${invoiceId}::uuid AND a.user_id = ${userId}::uuid`;

    if (!invoice) throw new DomainError(ERROR_CODES.NOT_FOUND, 'invoice not found');

    const open = money(fixed(invoice.open_amount));
    const total = sum(input.sources.map((s) => money(s.amount)));

    // BR31: a card is not a savings account — paying more than is open is rejected.
    if (Number(total) > Number(open)) {
      throw new DomainError(ERROR_CODES.OVERPAYMENT, 'more than the open amount', {
        openAmount: open,
        attempted: total,
      });
    }

    const transaction = await this.transactions.create(userId, {
      kind: 'TRANSFER',
      occurrenceType: 'OCCASIONAL',
      categoryId: null, // a transfer is not spending, so it carries no category
      description: `Fatura ${invoice.card_name} ${invoice.reference_month.toISOString().slice(0, 7)}`,
      occurredOn: input.paidOn,
      totalAmount: total,
      currency: 'BRL',
      entries: [
        ...input.sources.map((s) => ({
          side: 'SOURCE' as const,
          accountId: s.accountId,
          amount: money(s.amount),
          installmentCount: 1,
        })),
        {
          side: 'DESTINATION' as const,
          cardId: invoice.card_id,
          cardFunction: 'CREDIT' as const,
          amount: total,
          installmentCount: 1,
        },
      ],
    });

    // The destination settlement is what `v_invoice_total` counts as paid.
    await this.prisma.$executeRaw`
      UPDATE settlement SET invoice_id = ${invoiceId}::uuid, settled_on = ${new Date(input.paidOn)}
       WHERE entry_id IN (
         SELECT id FROM entry WHERE transaction_id = ${transaction.id}::uuid AND side = 'DESTINATION')`;

    /*
     * BR07, second half: a credit charge "only reaches the bank account when
     * the invoice is paid". Recording the payment alone left every charge with
     * settled_on NULL for ever, so card spending never became a settled
     * expense — `period_balance` counts INCOME and EXPENSE settlements and
     * skips transfers, so the money left the account without any period ever
     * showing it, and the carried balance grew by the whole invoice.
     *
     * Only a fully covered invoice settles its charges: a part payment leaves
     * the debt owed, and half-settling arbitrary lines would invent a date for
     * money that has not moved.
     */
    await this.prisma.$executeRaw`
      UPDATE settlement s SET settled_on = ${new Date(input.paidOn)}
        FROM entry e, v_invoice_total v
       WHERE e.id = s.entry_id AND e.side = 'SOURCE'
         AND s.invoice_id = ${invoiceId}::uuid AND s.settled_on IS NULL
         AND v.invoice_id = s.invoice_id AND v.open_amount <= 0`;

    await this.refreshStatus(invoiceId);
    return this.one(userId, invoiceId);
  }

  /** BR32: status is derived from the settlements, never set by hand. */
  async refreshStatus(invoiceId: string): Promise<void> {
    // ARCH02: the clock is injected, never read from the database — otherwise
    // a test's fixed date says one thing and CURRENT_DATE another, and the
    // suite starts failing on the calendar rather than on the code.
    const today = this.clock.now();
    await this.prisma.$executeRaw`
      UPDATE invoice i SET status = CASE
        WHEN v.open_amount <= 0                        THEN 'PAID'
        WHEN v.due_on < ${today}::date                 THEN 'OVERDUE'
        WHEN v.paid > 0                                THEN 'PARTIALLY_PAID'
        WHEN i.closes_on < CURRENT_DATE                THEN 'CLOSED'
        ELSE 'OPEN' END
      FROM v_invoice_total v
      WHERE v.invoice_id = i.id AND i.id = ${invoiceId}::uuid`;
  }

  private async one(userId: string, invoiceId: string) {
    const all = await this.list(userId);
    return all.find((i) => i.id === invoiceId) ?? null;
  }
}

const fixed = (value: unknown): string => Number(String(value ?? 0)).toFixed(2);
