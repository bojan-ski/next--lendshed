import Link from "next/link";
import { notFound } from "next/navigation";
import BookedRanges from "@/components/items/BookedRanges";
import RequestCard from "@/components/items/RequestCard";
import Avatar from "@/components/ui/Avatar";
import ButtonLink from "@/components/ui/ButtonLink";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { getItemForViewer } from "@/data/browse";
import { requireViewer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { initialsOf } from "@/lib/text/initials";
import { t } from "@/lib/text/interpolate";
import { itemStatus } from "@/lib/text/status";
import { itemPage } from "@/strings/itemPage";
import { items } from "@/strings/items";
import { photos } from "@/strings/photos";
import type { ItemDetailDTO } from "@/types/item";

const CHIP = "rounded-full bg-neutral-soft px-3 py-1 text-sm";
const PHOTO_PLACEHOLDER = "aspect-square w-full rounded-card";

function Details({ item }: { item: ItemDetailDTO }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="min-w-0 text-3xl font-bold wrap-break-word">
          {item.title}
        </h1>
        {item.isOwn && <StatusLabel status={itemStatus[item.status]} />}
      </div>
      <ul className="flex flex-wrap gap-2">
        <li className={CHIP}>{item.categoryName}</li>
        <li className={CHIP}>
          {t(itemPage.conditionChip, {
            condition: items.condition[item.condition],
          })}
        </li>
      </ul>
      <p>
        {item.maxLoanDays === 1
          ? itemPage.lendsForOne
          : t(itemPage.lendsForOther, { days: item.maxLoanDays })}
      </p>
      {/* Only the area truncates: an overflow box would clip the link's ring. */}
      <p className="flex min-w-0 items-center gap-3">
        <Avatar initials={initialsOf(item.owner.displayName)} aria-hidden />
        <span className="flex min-w-0 items-center">
          <Link
            href={`/members/${item.owner.id}`}
            className="inline-flex min-h-11 shrink-0 items-center font-bold text-accent underline underline-offset-4"
          >
            {item.owner.displayName}
          </Link>
          {item.owner.area && (
            <span className="min-w-0 truncate whitespace-pre text-muted">
              {t(itemPage.ownerArea, { area: item.owner.area })}
            </span>
          )}
        </span>
      </p>
      {item.description && (
        <p className="whitespace-pre-line wrap-break-word">
          {item.description}
        </p>
      )}
      {item.pickupNotes && (
        <p className="whitespace-pre-line wrap-break-word">
          {t(itemPage.pickup, { notes: item.pickupNotes })}
        </p>
      )}
    </div>
  );
}

// Guards itself: soft navigations don't re-run the layout. Anything outside
// the item-page scope is not-found, whatever the reason.
export default async function ItemDetailSection({
  params,
}: Pick<PageProps<"/items/[id]">, "params">) {
  const viewer = await requireViewer();
  const today = requestToday();
  const { id } = await params;
  const item = await getItemForViewer(viewer, id, today);
  if (!item) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        {item.photo ? (
          <PhotoImage
            photo={item.photo}
            alt={t(photos.previewAlt, { title: item.title })}
            unoptimized
            className="h-auto w-auto max-w-full self-start rounded-card"
            fallbackClassName={PHOTO_PLACEHOLDER}
          />
        ) : (
          <PhotoPlaceholder iconSize={48} className={PHOTO_PLACEHOLDER} />
        )}
        <Details item={item} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <BookedRanges ranges={item.bookedRanges} today={today} />
        {!item.isOwn && <RequestCard item={item} today={today} />}
        {item.isOwn && (
          <div className="flex flex-col items-start gap-3">
            <p className="font-bold">{itemPage.ownItem}</p>
            {item.status !== "retired" && (
              <ButtonLink href={`/my/items/${item.id}/edit`} variant="outline">
                {itemPage.edit}
              </ButtonLink>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
