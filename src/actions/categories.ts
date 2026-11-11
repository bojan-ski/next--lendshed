"use server";

import { updateTag } from "next/cache";
import { z } from "zod";
import {
  insertCategory,
  removeCategory,
  updateCategoryName,
} from "@/data/categories";
import { requireOrganizer } from "@/lib/auth/guards";
import {
  categoryIdSchema,
  categorySchema,
  renameCategorySchema,
} from "@/lib/schemas/categories";
import { categories } from "@/strings/categories";
import type {
  DeleteCategoryState,
  NewCategoryState,
  RenameCategoryState,
} from "@/types/categories";

// The refused state echoes the typed name: React resets the form after every submit.
function echoName(formData: FormData): { name: string } {
  const name = formData.get("name");
  return { name: typeof name === "string" ? name : "" };
}

export async function createCategory(
  _prev: NewCategoryState,
  formData: FormData,
): Promise<NewCategoryState> {
  await requireOrganizer();

  const parsed = categorySchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: echoName(formData),
    };
  }

  let result: Awaited<ReturnType<typeof insertCategory>>;
  try {
    result = await insertCategory(parsed.data.name);
  } catch {
    return { formError: "unexpected" };
  }
  if (result === "duplicate") {
    return {
      fieldErrors: { name: [categories.nameTaken] },
      values: echoName(formData),
    };
  }

  updateTag("categories");
  return { flash: "categoryAdded" };
}

export async function renameCategory(
  _prev: RenameCategoryState,
  formData: FormData,
): Promise<RenameCategoryState> {
  await requireOrganizer();

  const id = categoryIdSchema.safeParse({ id: formData.get("id") });
  if (!id.success) return { formError: "stale" };
  const parsed = renameCategorySchema.safeParse({
    id: id.data.id,
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return {
      fieldErrors: z.flattenError(parsed.error).fieldErrors,
      values: echoName(formData),
    };
  }

  let result: Awaited<ReturnType<typeof updateCategoryName>>;
  try {
    result = await updateCategoryName(parsed.data);
  } catch {
    return { formError: "unexpected" };
  }
  if (result === "missing") return { formError: "stale" };
  if (result === "duplicate") {
    return {
      fieldErrors: { name: [categories.nameTaken] },
      values: echoName(formData),
    };
  }

  updateTag("categories");
  return { flash: "categoryRenamed" };
}

export async function deleteCategory(
  _prev: DeleteCategoryState,
  formData: FormData,
): Promise<DeleteCategoryState> {
  await requireOrganizer();

  const parsed = categoryIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };

  let result: Awaited<ReturnType<typeof removeCategory>>;
  try {
    result = await removeCategory(parsed.data.id);
  } catch {
    return { formError: "unexpected" };
  }
  if (result === "missing") return { formError: "stale" };

  updateTag("categories");
  return { flash: "categoryDeleted" };
}
