import { z } from "zod";
import { normaliseCategoryName } from "@/lib/categories/name";
import { categories } from "@/strings/categories";

export const CATEGORY_NAME_MIN = 2;
export const CATEGORY_NAME_MAX = 30;

// Length is checked on the normalised name (OQ-29).
export const categorySchema = z.object({
  name: z
    .string({ error: categories.nameTooShort })
    .transform(normaliseCategoryName)
    .pipe(
      z
        .string()
        .min(CATEGORY_NAME_MIN, { error: categories.nameTooShort })
        .max(CATEGORY_NAME_MAX, { error: categories.nameTooLong }),
    ),
});

// A bad id is a stale screen, never a field error.
export const categoryIdSchema = z.object({
  id: z.string().min(1),
});

export const renameCategorySchema = categorySchema.extend(
  categoryIdSchema.shape,
);

export type CategoryInput = z.infer<typeof categorySchema>;
export type RenameCategoryInput = z.infer<typeof renameCategorySchema>;
