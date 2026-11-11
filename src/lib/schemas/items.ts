import { z } from "zod";
import type { ItemCondition } from "@/generated/prisma/enums";
import { items } from "@/strings/items";

export const ITEM_TITLE_MIN = 3;
export const ITEM_TITLE_MAX = 80;
export const ITEM_DESCRIPTION_MAX = 1000;
export const ITEM_PICKUP_NOTES_MAX = 300;
export const ITEM_MAX_LOAN_DAYS = 30;
export const ITEM_MAX_LOAN_DAYS_DEFAULT = 7;
export const ITEM_CAP = 30;

// A literal tuple, so this client-safe module imports no generated runtime.
export const ITEM_CONDITIONS = [
  "new",
  "good",
  "worn",
  "needs_care",
] as const satisfies readonly ItemCondition[];

// Browsers submit textarea line breaks as CRLF: normalise before counting.
const multiline = (max: number, message: string) =>
  z
    .string()
    .nullish()
    .transform((text) => (text ?? "").replace(/\r\n?/g, "\n"))
    .pipe(z.string().trim().max(max, { error: message }));

export const itemDetailsSchema = z.object({
  title: z
    .string({ error: items.titleTooShort })
    .trim()
    .min(ITEM_TITLE_MIN, { error: items.titleTooShort })
    .max(ITEM_TITLE_MAX, { error: items.titleTooLong }),
  description: multiline(ITEM_DESCRIPTION_MAX, items.descriptionTooLong),
  categoryId: z
    .string({ error: items.categoryRequired })
    .trim()
    .min(1, { error: items.categoryRequired }),
  condition: z.enum(ITEM_CONDITIONS, { error: items.conditionRequired }),
  maxLoanDays: z.coerce
    .number({ error: items.maxLoanDaysRange })
    .int({ error: items.maxLoanDaysRange })
    .min(1, { error: items.maxLoanDaysRange })
    .max(ITEM_MAX_LOAN_DAYS, { error: items.maxLoanDaysRange }),
  pickupNotes: multiline(
    ITEM_PICKUP_NOTES_MAX,
    items.pickupNotesTooLong,
  ).transform((text) => text || null),
});

// A bad id is a stale screen, never a field error.
export const itemIdSchema = z.object({
  id: z.string().min(1),
});

export const updateItemSchema = itemDetailsSchema.extend(itemIdSchema.shape);

export type ItemDetailsInput = z.infer<typeof itemDetailsSchema>;
export type UpdateItemInput = z.infer<typeof updateItemSchema>;
