import type { PrismaService } from '../../database/prisma.service.js';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * Turns a statement's category text into a category id: matched by name
 * ignoring case and accents (a top-level one wins a tie), created when it does
 * not exist yet. Blank stays Uncategorized (BR01).
 */
export async function categoryMatcher(prisma: PrismaService, userId: string) {
  const known = new Map<string, string>();
  const rows = await prisma.category.findMany({ where: { userId }, orderBy: { parentId: { sort: 'desc', nulls: 'last' } } });
  for (const c of rows) known.set(norm(c.name), c.id); // top-level last, so it wins
  const created: string[] = [];

  return {
    created,
    async resolve(text: string | undefined): Promise<string | null> {
      const name = text?.trim();
      if (!name) return null;
      const hit = known.get(norm(name));
      if (hit) return hit;
      const c = await prisma.category.create({ data: { userId, name } });
      known.set(norm(name), c.id);
      created.push(name);
      return c.id;
    },
  };
}
