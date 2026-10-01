import { Injectable } from '@nestjs/common';

import { ERROR_CODES } from '@cc/domain/rules';

import { DomainError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Savings goals (UC06).
 *
 * BR15: a goal reads its progress from exactly one source — a wallet, a single
 * account, or manual contributions — never a card, because a card holds debt.
 * Linking is read-only: it never reserves, locks or moves money, and progress
 * follows the linked balance both up and down.
 */
@Injectable()
export class GoalsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const goals = await this.prisma.goal.findMany({
      where: { userId },
      include: { contributions: true },
      orderBy: { createdAt: 'asc' },
    });

    const walletBalances = await this.prisma.$queryRaw<{ wallet_id: string; balance: unknown }[]>`
      SELECT wallet_id::text, balance FROM v_wallet_balance WHERE user_id = ${userId}::uuid`;
    const accountBalances = await this.prisma.$queryRaw<{ account_id: string; balance: unknown }[]>`
      SELECT account_id::text, balance FROM v_account_balance WHERE user_id = ${userId}::uuid`;

    return goals.map((g) => {
      // BR15: progress is READ from the source, never stored (BR36).
      const current =
        g.sourceType === 'WALLET'
          ? num(walletBalances.find((w) => w.wallet_id === g.walletId)?.balance)
          : g.sourceType === 'ACCOUNT'
            ? num(accountBalances.find((a) => a.account_id === g.accountId)?.balance)
            : g.contributions.reduce((sum, c) => sum + Number(c.amount), 0);

      const target = Number(g.targetAmount);
      const percent = target > 0 ? Math.min(Math.round((current / target) * 100), 999) : 0;
      const remaining = Math.max(target - current, 0);
      const monthsLeft = monthsUntil(g.deadline);

      return {
        id: g.id,
        name: g.name,
        sourceType: g.sourceType,
        target: target.toFixed(2),
        current: current.toFixed(2),
        remaining: remaining.toFixed(2),
        percent,
        deadline: g.deadline.toISOString().slice(0, 10),
        // Frontend arithmetic on figures already fetched would be fine too, but
        // the required monthly amount depends on the deadline maths, so it is
        // computed once here.
        monthlyNeeded: monthsLeft > 0 ? (remaining / monthsLeft).toFixed(2) : remaining.toFixed(2),
        complete: current >= target,
      };
    });
  }

  async create(
    userId: string,
    input: {
      name: string;
      targetAmount: string;
      deadline: string;
      sourceType: 'WALLET' | 'ACCOUNT' | 'MANUAL';
      walletId?: string | null;
      accountId?: string | null;
    },
  ) {
    // BR15: exactly one source. The form may send all three fields, so keep
    // only the one the source type names — the others are forced null. The
    // database CHECK is the final authority; this makes the common path clean.
    const walletId = input.sourceType === 'WALLET' ? (input.walletId ?? null) : null;
    const accountId = input.sourceType === 'ACCOUNT' ? (input.accountId ?? null) : null;
    if (input.sourceType === 'WALLET' && !walletId) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'escolha uma carteira');
    }
    if (input.sourceType === 'ACCOUNT' && !accountId) {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'escolha uma conta');
    }

    return this.prisma.goal.create({
      data: {
        userId,
        name: input.name,
        targetAmount: input.targetAmount,
        deadline: new Date(input.deadline),
        sourceType: input.sourceType,
        walletId,
        accountId,
      },
    });
  }

  async update(
    userId: string,
    id: string,
    patch: { name?: string; targetAmount?: string; deadline?: string; status?: string },
  ) {
    const goal = await this.prisma.goal.findFirst({ where: { id, userId } });
    if (!goal) throw new DomainError(ERROR_CODES.NOT_FOUND, 'goal not found');
    return this.prisma.goal.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.targetAmount !== undefined ? { targetAmount: patch.targetAmount } : {}),
        ...(patch.deadline !== undefined ? { deadline: new Date(patch.deadline) } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      },
    });
  }

  /** Deleting a goal removes its manual contributions too (ON DELETE CASCADE). */
  async remove(userId: string, id: string) {
    const { count } = await this.prisma.goal.deleteMany({ where: { id, userId } });
    return { deleted: count };
  }

  async contribute(userId: string, goalId: string, amount: string, on: string) {
    const goal = await this.prisma.goal.findFirst({ where: { id: goalId, userId } });
    if (!goal) throw new DomainError(ERROR_CODES.NOT_FOUND, 'goal not found');
    if (goal.sourceType !== 'MANUAL') {
      throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 'only manual goals take contributions');
    }
    return this.prisma.goalContribution.create({
      data: { goalId, amount, contributedOn: new Date(on) },
    });
  }
}

const num = (v: unknown): number => Number(String(v ?? 0));

function monthsUntil(deadline: Date): number {
  const now = new Date();
  return Math.max(
    (deadline.getUTCFullYear() - now.getUTCFullYear()) * 12 +
      (deadline.getUTCMonth() - now.getUTCMonth()),
    0,
  );
}
