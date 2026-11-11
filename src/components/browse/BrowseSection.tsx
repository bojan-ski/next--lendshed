import BrowsePager from "@/components/browse/BrowsePager";
import BrowseSearchForm from "@/components/browse/BrowseSearchForm";
import CategoryChips from "@/components/browse/CategoryChips";
import ItemGrid from "@/components/items/ItemGrid";
import ButtonLink from "@/components/ui/ButtonLink";
import EmptyState from "@/components/ui/EmptyState";
import { getBrowseItems } from "@/data/browse";
import { getCategories } from "@/data/categories";
import { requireViewer } from "@/lib/auth/guards";
import { browseHref } from "@/lib/browse/href";
import { communityToday } from "@/lib/dates/dates";
import { env } from "@/lib/env/server";
import { browseQuerySchema, type BrowseQuery } from "@/lib/schemas/browse";
import { t } from "@/lib/text/interpolate";
import { home } from "@/strings/home";

// This page's count, never a total: paging reads one extra row, no COUNT.
function statusLine(count: number, query: BrowseQuery, category?: string) {
  const parts = [
    t(count === 1 ? home.countOne : home.countOther, {
      count,
      page: query.page,
    }),
  ];
  if (query.q) parts.push(t(home.forSearch, { q: query.q }));
  if (category) parts.push(t(home.inCategory, { category }));
  return parts.join("");
}

function Empty({ query }: { query: BrowseQuery }) {
  if (query.page > 1) {
    return (
      <EmptyState
        icon="search"
        heading={home.noMoreHeading}
        body={home.noMoreBody}
        action={
          <ButtonLink
            href={browseHref({ ...query, page: 1 })}
            variant="outline"
          >
            {home.firstPage}
          </ButtonLink>
        }
      />
    );
  }
  if (query.q || query.category) {
    return (
      <EmptyState
        icon="search"
        heading={home.noMatchesHeading}
        body={home.noMatchesBody}
        action={
          <ButtonLink href="/" variant="outline">
            {home.showEverything}
          </ButtonLink>
        }
      />
    );
  }
  return (
    <EmptyState
      icon="toolbox"
      heading={home.emptyHeading}
      body={t(home.emptyBody, { community: env.COMMUNITY_NAME })}
      action={<ButtonLink href="/my/items/new">{home.listItem}</ButtonLink>}
    />
  );
}

// Guards itself: a search or a chip is a soft navigation, which doesn't re-run
// the layout. An unknown category id is treated as no filter ("All").
export default async function BrowseSection({
  searchParams,
}: Pick<PageProps<"/">, "searchParams">) {
  const viewer = await requireViewer();
  const today = communityToday();
  const parsed = browseQuerySchema.parse(await searchParams);
  const categories = await getCategories();
  const category = categories.find(({ id }) => id === parsed.category);
  const query = { ...parsed, category: category?.id ?? null };
  const page = await getBrowseItems(viewer.id, query, today);

  return (
    <div className="flex flex-col gap-4">
      <BrowseSearchForm q={query.q} category={query.category} />
      <CategoryChips categories={categories} query={query} />
      {/* The search doesn't move focus, so its outcome is announced (WCAG 4.1.3). */}
      <p role="status" className="text-sm text-muted">
        {statusLine(page.items.length, query, category?.name)}
      </p>
      {/* Past the end the previous page may not exist either; the empty
          state links back to page 1 instead of a pager. */}
      {page.items.length === 0 ? (
        <Empty query={query} />
      ) : (
        <>
          <ItemGrid items={page.items} />
          <BrowsePager
            page={page.page}
            hasPrevious={page.hasPrevious}
            hasNext={page.hasNext}
            query={query}
          />
        </>
      )}
    </div>
  );
}
