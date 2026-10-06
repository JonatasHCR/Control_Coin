import { Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@cc/domain/rules';
import type { CreateTransactionInput } from '@cc/domain/schemas';

import { Clock } from '../../common/clock/clock.js';
import { userError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TransactionsService } from '../transactions/transactions.service.js';

type Kind = 'INCOME' | 'EXPENSE' | 'TRANSFER';

export interface PlannedInput {
  kind: Kind;
  description: string;
  categoryId: string | null;
  amount: string;
  expectedOn: string;
  accountId: string | null;
  cardId: string | null;
  cardFunction: 'CREDIT' | 'DEBIT' | null;
  destinationAccountId: string | null;
  notifyDaysBefore: number;
}

/** What actually happened (BR40) — may differ from the plan in every field. */
export interface ConfirmInput {
  occurredOn: string;
  amount: string;
  description?: string | undefined;
  categoryId: string | null;
  accountId: string | null;
  cardId: string | null;
  cardFunction: 'CREDIT' | 'DEBIT' | null;
  installmentCount: number;
  destinationAccountId: string | null;
}

/**
 * Planned transactions (UC13, BR40). A plan affects nothing until confirmed;
 * confirming goes through TransactionsService, so every rule of a real
 * transaction (BR09, BR11, BR12, BR31…) applies to what is recorded.
 */
@Injectable()
export class PlannedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionsService,
    private readonly clock: Clock,
  ) {}

  async list(userId: string) {
    const include = {
      category: { select: { name: true } },
      account: { select: { name: true } },
      card: { select: { name: true } },
      destinationAccount: { select: { name: true } },
    } as const;
    const [pending, resolved] = await Promise.all([
      this.prisma.plannedTransaction.findMany({ where: { userId, status: 'PENDING' }, include, orderBy: { expectedOn: 'asc' } }),
      this.prisma.plannedTransaction.findMany({ where: { userId, status: { not: 'PENDING' } }, include, orderBy: { resolvedAt: 'desc' }, take: 20 }),
    ]);
    const shape = (p: (typeof pending)[number]) => ({
      id: p.id,
      kind: p.kind as Kind,
      description: p.description,
      amount: p.amount.toFixed(2),
      currency: p.currency,
      expectedOn: p.expectedOn.toISOString().slice(0, 10),
      categoryId: p.categoryId,
      categoryName: p.category?.name ?? null,
      accountId: p.accountId,
      cardId: p.cardId,
      cardFunction: p.cardFunction as 'CREDIT' | 'DEBIT' | null,
      sourceName: p.card?.name ?? p.account?.name ?? null,
      destinationAccountId: p.destinationAccountId,
      destinationName: p.destinationAccount?.name ?? null,
      notifyDaysBefore: p.notifyDaysBefore,
      status: p.status as 'PENDING' | 'CONFIRMED' | 'CANCELLED',
      transactionId: p.transactionId,
      resolvedAt: p.resolvedAt?.toISOString() ?? null,
    });
    return { pending: pending.map(shape), resolved: resolved.map(shape) };
  }

  async create(userId: string, input: PlannedInput) {
    const currency = await this.check(userId, input);
    return this.prisma.plannedTransaction.create({ data: { userId, ...input, currency, expectedOn: new Date(input.expectedOn) } });
  }

  async update(userId: string, id: string, input: PlannedInput) {
    await this.pending(userId, id);
    const currency = await this.check(userId, input);
    return this.prisma.plannedTransaction.update({ where: { id }, data: { ...input, currency, expectedOn: new Date(input.expectedOn) } });
  }

  async remove(userId: string, id: string) {
    const { count } = await this.prisma.plannedTransaction.deleteMany({ where: { id, userId } });
    return { deleted: count };
  }

  /**
   * "Ainda não aconteceu": moves the expected date forward. Never backward —
   * and never into the past, which would only re-raise the same reminder.
   */
  async postpone(userId: string, id: string, expectedOn: string) {
    const plan = await this.pending(userId, id);
    const current = plan.expectedOn.toISOString().slice(0, 10);
    if (expectedOn <= current) {
      throw userError(ERROR_CODES.VALIDATION_FAILED, `a nova data precisa ser depois de ${current.split('-').reverse().join('/')}`);
    }
    if (expectedOn < this.clock.today()) {
      throw userError(ERROR_CODES.VALIDATION_FAILED, 'a nova data não pode ser no passado');
    }
    return this.prisma.plannedTransaction.update({ where: { id }, data: { expectedOn: new Date(expectedOn) } });
  }

  /** "Não vai acontecer": closes the plan, records nothing. */
  async cancel(userId: string, id: string) {
    await this.pending(userId, id);
    return this.prisma.plannedTransaction.update({ where: { id }, data: { status: 'CANCELLED', resolvedAt: new Date() } });
  }

  async confirm(userId: string, id: string, input: ConfirmInput) {
    const plan = await this.pending(userId, id);
    const kind = plan.kind as Kind;
    const amount = input.amount;

    let source: { accountId: string } | { cardId: string; cardFunction: 'CREDIT' | 'DEBIT' } | null = null;
    if (input.cardId) {
      if (kind !== 'EXPENSE') throw userError(ERROR_CODES.VALIDATION_FAILED, 'cartão só para despesa');
      if (!input.cardFunction) throw userError(ERROR_CODES.VALIDATION_FAILED, 'escolha crédito ou débito');
      source = { cardId: input.cardId, cardFunction: input.cardFunction };
    } else if (input.accountId) {
      source = { accountId: input.accountId };
    }
    if (!source) {
      throw userError(ERROR_CODES.VALIDATION_FAILED, kind === 'INCOME' ? 'diga em que conta recebeu' : 'diga de onde saiu o dinheiro');
    }
    if (kind === 'TRANSFER' && !input.destinationAccountId) {
      throw userError(ERROR_CODES.VALIDATION_FAILED, 'diga para qual conta transferiu');
    }
    const installments = 'cardId' in source && source.cardFunction === 'CREDIT' ? input.installmentCount : 1;

    const entries =
      kind === 'INCOME'
        ? [{ side: 'DESTINATION' as const, ...(source as { accountId: string }), amount }]
        : kind === 'EXPENSE'
          ? [{ side: 'SOURCE' as const, ...source, amount, installmentCount: installments }]
          : [
              { side: 'SOURCE' as const, ...source, amount },
              { side: 'DESTINATION' as const, accountId: input.destinationAccountId!, amount },
            ];

    const currency = await this.currencyOf(userId, input.accountId, input.cardId);
    const transaction = await this.transactions.create(userId, {
      kind,
      occurrenceType: installments > 1 ? 'INSTALLMENT' : 'OCCASIONAL',
      categoryId: kind === 'TRANSFER' ? null : input.categoryId,
      description: input.description?.trim() || plan.description,
      occurredOn: input.occurredOn,
      totalAmount: amount,
      currency,
      entries,
    } as CreateTransactionInput);

    return this.prisma.plannedTransaction.update({
      where: { id },
      data: { status: 'CONFIRMED', resolvedAt: new Date(), transactionId: transaction.id },
    });
  }

  private async pending(userId: string, id: string) {
    const plan = await this.prisma.plannedTransaction.findFirst({ where: { id, userId } });
    if (!plan) throw userError(ERROR_CODES.NOT_FOUND, 'previsto não encontrado');
    if (plan.status !== 'PENDING') throw userError(ERROR_CODES.VALIDATION_FAILED, 'este previsto já foi resolvido');
    return plan;
  }

  /** The expected source/destination must be the caller's; returns the currency. */
  private async check(userId: string, input: PlannedInput): Promise<string> {
    if (input.accountId && input.cardId) throw userError(ERROR_CODES.VALIDATION_FAILED, 'escolha conta OU cartão');
    if (input.cardId && input.kind !== 'EXPENSE') throw userError(ERROR_CODES.VALIDATION_FAILED, 'cartão só para despesa');
    if (input.destinationAccountId) {
      const ok = await this.prisma.account.count({ where: { id: input.destinationAccountId, userId } });
      if (!ok) throw userError(ERROR_CODES.NOT_FOUND, 'conta destino não encontrada');
    }
    if (input.categoryId) {
      const ok = await this.prisma.category.count({ where: { id: input.categoryId, userId } });
      if (!ok) throw userError(ERROR_CODES.NOT_FOUND, 'categoria não encontrada');
    }
    return this.currencyOf(userId, input.accountId, input.cardId);
  }

  private async currencyOf(userId: string, accountId: string | null, cardId: string | null): Promise<string> {
    if (cardId) {
      const card = await this.prisma.card.findFirst({ where: { id: cardId, account: { userId } }, include: { account: true } });
      if (!card) throw userError(ERROR_CODES.NOT_FOUND, 'cartão não encontrado');
      return card.account.currency;
    }
    if (accountId) {
      const account = await this.prisma.account.findFirst({ where: { id: accountId, userId } });
      if (!account) throw userError(ERROR_CODES.NOT_FOUND, 'conta não encontrada');
      return account.currency;
    }
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    return user.mainCurrency;
  }
}
