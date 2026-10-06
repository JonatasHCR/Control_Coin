import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ERROR_CODES } from '@cc/domain/rules';

import { DomainError } from '../../common/errors/domain-error.js';
import { PrismaService } from '../../database/prisma.service.js';

/**
 * Categories (UC04).
 *
 * BR13 is expressed by what is missing: there is no `kind` column, so the same
 * category serves income and expenses.
 *
 * BR17/BR20 are read at query time, which means flipping the essential flag or
 * changing a target **rewrites past reports**. That is the intended behaviour —
 * and exactly why every such change is written to `audit_event`, so "why did my
 * January figure change?" stays answerable.
 */
@Injectable()
export class CategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const categories = await this.prisma.category.findMany({
      where: { userId, archived: false },
      orderBy: [{ parentId: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    });

    const averages = await this.prisma.$queryRaw<{ category_id: string; average: unknown }[]>`
      SELECT t.category_id::text,
             ROUND(SUM(s.amount) / GREATEST(COUNT(DISTINCT
               settlement_competence_month(s.invoice_id, s.due_on, t.occurred_on, s.sequence_no)), 1), 2) AS average
        FROM settlement s
        JOIN entry e       ON e.id = s.entry_id
        JOIN transaction t ON t.id = e.transaction_id
       WHERE t.user_id = ${userId}::uuid AND t.kind = 'EXPENSE' AND e.side = 'SOURCE'
         AND t.category_id IS NOT NULL
       GROUP BY t.category_id`;

    return categories.map((c) => ({
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      isEssential: c.isEssential,
      monthlyTarget: c.monthlyTarget?.toFixed(2) ?? null,
      average:
        Number(String(averages.find((a) => a.category_id === c.id)?.average ?? 0)).toFixed(2),
    }));
  }

  create(userId: string, input: { name: string; parentId?: string | null; isEssential?: boolean; monthlyTarget?: string | null }) {
    return this.prisma.category.create({
      data: {
        userId,
        name: input.name,
        parentId: input.parentId ?? null,
        isEssential: input.isEssential ?? false,
        monthlyTarget: input.monthlyTarget ?? null,
      },
    });
  }

  /**
   * A change here is retroactive: it re-describes months that are already
   * closed. The audit row is what makes that traceable rather than mysterious.
   */
  async update(
    userId: string,
    id: string,
    patch: { name?: string | undefined; isEssential?: boolean | undefined; monthlyTarget?: string | null | undefined },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.category.findFirstOrThrow({ where: { id, userId } });

      // Build the update explicitly: with exactOptionalPropertyTypes an
      // `undefined` key is not the same as an absent one.
      const data: Prisma.CategoryUpdateInput = {};
      if (patch.name !== undefined) data.name = patch.name;
      if (patch.isEssential !== undefined) data.isEssential = patch.isEssential;
      if (patch.monthlyTarget !== undefined) data.monthlyTarget = patch.monthlyTarget;

      const after = await tx.category.update({ where: { id }, data });

      const retroactive =
        (patch.isEssential !== undefined && patch.isEssential !== before.isEssential) ||
        (patch.monthlyTarget !== undefined &&
          patch.monthlyTarget !== (before.monthlyTarget?.toFixed(2) ?? null));

      if (retroactive) {
        await tx.$executeRaw`
          INSERT INTO audit_event (id, user_id, entity_type, entity_id, action, before, after)
          VALUES (gen_random_uuid(), ${userId}::uuid, 'CATEGORY', ${id}::uuid, 'RETROACTIVE_CHANGE',
                  ${JSON.stringify({
                    isEssential: before.isEssential,
                    monthlyTarget: before.monthlyTarget?.toFixed(2) ?? null,
                  })}::jsonb,
                  ${JSON.stringify({
                    isEssential: after.isEssential,
                    monthlyTarget: after.monthlyTarget?.toFixed(2) ?? null,
                  })}::jsonb)`;
      }

      return after;
    });
  }

  /**
   * UC04: removing a category never deletes its transactions. They are either
   * reassigned to another category or left *Uncategorized* (the FK is
   * ON DELETE SET NULL). Subcategories are promoted to top level rather than
   * deleted, unless the caller asks otherwise.
   */
  async remove(
    userId: string,
    id: string,
    options: { reassignTo?: string | null; deleteChildren?: boolean } = {},
  ) {
    const category = await this.prisma.category.findFirst({ where: { id, userId } });
    if (!category) throw new DomainError(ERROR_CODES.NOT_FOUND, 'category not found');

    return this.prisma.$transaction(async (tx) => {
      if (options.reassignTo) {
        // Move this category's transactions to another before deleting.
        await tx.transaction.updateMany({
          where: { userId, categoryId: id },
          data: { categoryId: options.reassignTo },
        });
      }
      // Children: promote to top level (parent → null) unless asked to delete.
      const children = await tx.category.findMany({ where: { parentId: id } });
      if (children.length > 0) {
        if (options.deleteChildren) {
          await tx.category.deleteMany({ where: { parentId: id } });
        } else {
          await tx.category.updateMany({ where: { parentId: id }, data: { parentId: null } });
        }
      }
      await tx.category.delete({ where: { id } }); // remaining transactions → SET NULL
      return { deleted: id };
    });
  }
}
