import Link from "next/link";
import { browseHref } from "@/lib/browse/href";
import type { BrowseQuery } from "@/lib/schemas/browse";
import { cn } from "@/lib/text/cn";
import { home } from "@/strings/home";
import type { CategoryDTO } from "@/types/categories";

function chipClasses(current: boolean) {
  return cn(
    "inline-flex min-h-11 items-center rounded-control border border-line px-4",
    current ? "bg-accent-soft font-bold text-accent" : "bg-card text-ink",
  );
}

// A chip keeps the search and resets the page.
export default function CategoryChips({
  categories,
  query,
}: {
  categories: CategoryDTO[];
  query: BrowseQuery;
}) {
  const chips = [
    { id: null, name: home.allCategories },
    ...categories.map(({ id, name }) => ({ id, name })),
  ];
  return (
    <nav aria-label={home.categoriesLabel}>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const current = chip.id === query.category;
          return (
            <li key={chip.id ?? "all"}>
              <Link
                href={browseHref({ q: query.q, category: chip.id })}
                aria-current={current ? "page" : undefined}
                className={chipClasses(current)}
              >
                {chip.name}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
