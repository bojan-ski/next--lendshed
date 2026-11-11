import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { db } from "@/db";
import { isCategoryReferenced } from "@/data/db-errors";
import { Prisma } from "@/generated/prisma/client";
import { categoryNameKey, normaliseCategoryName } from "@/lib/categories/name";
import type { AdminCategoryDTO, CategoryDTO } from "@/types/categories";

const rowSelect = { id: true, name: true } satisfies Prisma.CategorySelect;

type CategoryRow = Prisma.CategoryGetPayload<{ select: typeof rowSelect }>;

export function toCategoryDTO(row: CategoryRow): CategoryDTO {
  return { id: row.id, name: row.name };
}

// Global rows with no owner and no request data, so one entry serves everyone.
export async function getCategories(): Promise<CategoryDTO[]> {
  "use cache";
  cacheTag("categories");
  cacheLife("days");

  const rows = await db.category.findMany({
    orderBy: { nameKey: "asc" },
    select: rowSelect,
  });
  return rows.map(toCategoryDTO);
}

// `inUse` stays uncached: item writes never invalidate `categories`. Retired
// items count, since Item → Category is Restrict.
export async function getAdminCategories(): Promise<AdminCategoryDTO[]> {
  const [rows, used] = await Promise.all([
    getCategories(),
    db.item.groupBy({ by: ["categoryId"] }),
  ]);
  const inUse = new Set(used.map((item) => item.categoryId));
  return rows.map((row) => ({ ...row, inUse: inUse.has(row.id) }));
}

// Writers normalise again, so the stored name always matches its key.
export async function insertCategory(
  name: string,
): Promise<"created" | "duplicate"> {
  try {
    await db.category.create({
      data: {
        name: normaliseCategoryName(name),
        nameKey: categoryNameKey(name),
      },
    });
  } catch (error) {
    if (isNameKeyTaken(error)) return "duplicate";
    throw error;
  }
  return "created";
}

export async function updateCategoryName(input: {
  id: string;
  name: string;
}): Promise<"renamed" | "duplicate" | "missing"> {
  let count: number;
  try {
    ({ count } = await db.category.updateMany({
      where: { id: input.id },
      data: {
        name: normaliseCategoryName(input.name),
        nameKey: categoryNameKey(input.name),
      },
    }));
  } catch (error) {
    if (isNameKeyTaken(error)) return "duplicate";
    throw error;
  }
  return count === 1 ? "renamed" : "missing";
}

// The pre-check answers the common case; the Restrict FK catches an item
// inserted between it and the delete.
export async function removeCategory(
  id: string,
): Promise<"deleted" | "missing" | "inUse"> {
  if ((await db.item.count({ where: { categoryId: id }, take: 1 })) > 0) {
    return "inUse";
  }
  let count: number;
  try {
    ({ count } = await db.category.deleteMany({ where: { id } }));
  } catch (error) {
    if (isCategoryReferenced(error)) return "inUse";
    throw error;
  }
  return count === 1 ? "deleted" : "missing";
}

// Under the pg adapter a P2002 names its constraint here, not in meta.target.
function isNameKeyTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const cause = (error.meta?.driverAdapterError as { cause?: unknown })?.cause;
  const constraint = (cause as { constraint?: { index?: unknown } })
    ?.constraint;
  return constraint?.index === "category_nameKey_key";
}
