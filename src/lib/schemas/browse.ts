import { z } from "zod";
import { ITEM_TITLE_MAX } from "@/lib/schemas/items";

export const BROWSE_PAGE_SIZE = 24;
export const BROWSE_MAX_PAGE = 500;

// Malformed input never errors: each field falls back on its own. A category
// id that isn't a real category is dropped by the section, not here.
export const browseQuerySchema = z.object({
  q: z.string().trim().max(ITEM_TITLE_MAX).catch(""),
  category: z.string().trim().min(1).max(64).nullable().catch(null),
  page: z.coerce.number().int().min(1).max(BROWSE_MAX_PAGE).catch(1),
});

export type BrowseQuery = z.infer<typeof browseQuerySchema>;
