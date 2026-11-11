import type { BrowseQuery } from "@/lib/schemas/browse";

// "/" plus q, category and page in that order; defaults are left out.
export function browseHref({
  q,
  category,
  page,
}: Partial<BrowseQuery>): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (category) params.set("category", category);
  if (page !== undefined && page > 1) params.set("page", String(page));
  const search = params.toString();
  return search ? `/?${search}` : "/";
}
