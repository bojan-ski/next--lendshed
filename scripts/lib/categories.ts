import type { PrismaClient } from "@/generated/prisma/client";
import { categoryNameKey, normaliseCategoryName } from "@/lib/categories/name";

export type EnsureCategoriesResult = { created: number; existing: number };

// Inserts each name whose key is absent; an existing row is never renamed,
// re-cased or deleted. ON CONFLICT DO NOTHING also absorbs a concurrent run.
export async function ensureCategories(
  client: PrismaClient,
  names: readonly string[],
): Promise<EnsureCategoriesResult> {
  const byKey = new Map<string, string>();
  for (const raw of names) {
    const name = normaliseCategoryName(raw);
    const key = categoryNameKey(name);
    if (!byKey.has(key)) byKey.set(key, name);
  }
  const { count } = await client.category.createMany({
    data: [...byKey].map(([nameKey, name]) => ({ name, nameKey })),
    skipDuplicates: true,
  });
  return { created: count, existing: byKey.size - count };
}
