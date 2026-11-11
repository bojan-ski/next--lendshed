import type { PrismaClient } from "@/generated/prisma/client";
import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import { ensureCategories } from "../../scripts/lib/categories";

// The same five as production; converges by name key and never deletes.
export async function seedCategories(client: PrismaClient): Promise<void> {
  await ensureCategories(client, PRODUCTION_CATEGORIES);
}
