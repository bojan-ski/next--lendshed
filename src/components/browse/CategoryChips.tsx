import Link from "next/link";
import { browseHref } from "@/lib/browse/href";
import type { BrowseQuery } from "@/lib/schemas/browse";
import { cn } from "@/lib/text/cn";
import { categoryHues, hueStyle } from "@/lib/text/hue";
import { home } from "@/strings/home";
import type { CategoryDTO } from "@/types/categories";

// The dot is a pseudo-element, so the link's text stays the category name.
function chipClasses(current: boolean, hasHue: boolean) {
  return cn(
    "inline-flex min-h-11 items-center gap-2.5 rounded-full whitespace-nowrap border-2 px-4.5 motion-safe:transition-[background-color] motion-safe:duration-150",
    "before:size-2.5 before:shrink-0 before:rounded-full before:content-['']",
    hasHue ? "before:bg-hue-strong" : "before:bg-current",
    current
      ? "border-ink bg-ink font-bold text-page"
      : cn(
          "bg-card text-ink hover:bg-page",
          hasHue ? "border-hue-border" : "border-line",
        ),
  );
}

// A chip keeps the search and resets the page. Under 640 px the chips scroll
// sideways in one row, bleeding to the screen edges past the 16 px gutter; the
// vertical padding keeps the focus ring inside the scroller's clip.
export default function CategoryChips({
  categories,
  query,
}: {
  categories: CategoryDTO[];
  query: BrowseQuery;
}) {
  const hues = categoryHues(categories);
  const chips = [
    { id: null, name: home.allCategories, hue: undefined },
    ...categories.map(({ id, name }) => ({ id, name, hue: hues.get(id) })),
  ];
  return (
    <nav aria-label={home.categoriesLabel}>
      <ul className="-mx-4 flex gap-2.5 overflow-x-auto px-4 py-1 scrollbar-none sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {chips.map((chip) => {
          const current = chip.id === query.category;
          return (
            <li key={chip.id ?? "all"} className="shrink-0">
              <Link
                href={browseHref({ q: query.q, category: chip.id })}
                aria-current={current ? "page" : undefined}
                style={chip.hue === undefined ? undefined : hueStyle(chip.hue)}
                className={chipClasses(current, chip.hue !== undefined)}
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
