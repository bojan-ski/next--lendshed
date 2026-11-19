import Link from "next/link";
import { buttonClasses } from "@/components/ui/button-styles";
import { Icon } from "@/components/ui/icons";
import { browseHref } from "@/lib/browse/href";
import type { BrowseQuery } from "@/lib/schemas/browse";
import { t } from "@/lib/text/interpolate";
import { home } from "@/strings/home";

const LINK = buttonClasses("outline", "gap-1 px-5");

type BrowsePagerProps = {
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
  query: BrowseQuery;
};

// Hidden when there is only one page; each link keeps q and category.
export default function BrowsePager({
  page,
  hasPrevious,
  hasNext,
  query,
}: BrowsePagerProps) {
  if (!hasPrevious && !hasNext) return null;
  return (
    <nav aria-label={home.pagesLabel}>
      <div className="flex items-center justify-between gap-4 pt-4">
        <div className="flex-1">
          {hasPrevious && (
            <Link
              href={browseHref({ ...query, page: page - 1 })}
              aria-label={home.previousLabel}
              className={LINK}
            >
              <Icon name="chevron-right" aria-hidden className="rotate-180" />
              {home.previous}
            </Link>
          )}
        </div>
        <p className="text-sm text-muted">{t(home.pageLine, { page })}</p>
        <div className="flex flex-1 justify-end">
          {hasNext && (
            <Link
              href={browseHref({ ...query, page: page + 1 })}
              aria-label={home.nextLabel}
              className={LINK}
            >
              {home.next}
              <Icon name="chevron-right" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
