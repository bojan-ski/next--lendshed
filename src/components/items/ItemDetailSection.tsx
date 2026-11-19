import Link from "next/link";
import { notFound } from "next/navigation";
import BookedRanges from "@/components/items/BookedRanges";
import OrganizerRetireCard from "@/components/items/OrganizerRetireCard";
import RequestCard from "@/components/items/RequestCard";
import Avatar from "@/components/ui/Avatar";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { getItemForViewer } from "@/data/browse";
import { getCategories } from "@/data/categories";
import { requireViewer } from "@/lib/auth/guards";
import { requestToday } from "@/lib/dates/request-today";
import { categoryHues, hueFor, hueStyle, type Hue } from "@/lib/text/hue";
import { initialsOf } from "@/lib/text/initials";
import { t } from "@/lib/text/interpolate";
import { itemStatus } from "@/lib/text/status";
import { itemPage } from "@/strings/itemPage";
import { items } from "@/strings/items";
import { photos } from "@/strings/photos";
import type { ItemDetailDTO } from "@/types/item";

const CHIP = "rounded-full px-3.5 py-1.5 text-sm font-bold";
const PHOTO_PLACEHOLDER = "aspect-square w-full rounded-band";

function Details({ item, hue }: { item: ItemDetailDTO; hue?: Hue }) {
  return (
    <div className="flex min-w-0 flex-col gap-4.5 lg:pt-2">
      <div className="flex flex-wrap items-center gap-4">
        <h1 className="min-w-0 type-page-title">{item.title}</h1>
        {item.isOwn && <StatusLabel status={itemStatus[item.status]} />}
      </div>
      <ul className="flex flex-wrap gap-2">
        <li
          style={hue === undefined ? undefined : hueStyle(hue)}
          className={`${CHIP} ${hue === undefined ? "bg-neutral-soft" : "bg-hue-soft text-hue-ink"}`}
        >
          {item.categoryName}
        </li>
        <li className={`${CHIP} bg-neutral-soft`}>
          {t(itemPage.conditionChip, {
            condition: items.condition[item.condition],
          })}
        </li>
      </ul>
      <p className="type-subhead text-accent">
        {item.maxLoanDays === 1
          ? itemPage.lendsForOne
          : t(itemPage.lendsForOther, { days: item.maxLoanDays })}
      </p>
      {/* Only the area truncates: an overflow box would clip the link's ring. */}
      <p className="flex max-w-full min-w-0 items-center gap-3.5 self-start rounded-full bg-card py-2.5 pr-5 pl-2.5">
        <Avatar
          initials={initialsOf(item.owner.displayName)}
          hue={hueFor(item.owner.id)}
          aria-hidden
          className="size-11"
        />
        <span className="flex min-w-0 items-center">
          <Link
            href={`/members/${item.owner.id}`}
            className="inline-flex min-h-11 shrink-0 items-center font-bold text-accent-ink underline underline-offset-4"
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
        <p className="text-lg/relaxed whitespace-pre-line wrap-break-word">
          {item.description}
        </p>
      )}
      {item.pickupNotes && (
        <p className="text-lg/relaxed whitespace-pre-line text-muted wrap-break-word">
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
  const hue = categoryHues(await getCategories()).get(item.categoryId);

  return (
    <div className="flex flex-col gap-7">
      <div className="grid gap-7 sm:grid-cols-2 lg:gap-10">
        {item.photo ? (
          <PhotoImage
            photo={item.photo}
            alt={t(photos.previewAlt, { title: item.title })}
            unoptimized
            className="h-auto w-auto max-w-full self-start rounded-band"
            fallbackClassName={PHOTO_PLACEHOLDER}
            hue={hue}
          />
        ) : (
          <PhotoPlaceholder
            iconSize={48}
            className={PHOTO_PLACEHOLDER}
            hue={hue}
          />
        )}
        <Details item={item} hue={hue} />
      </div>
      <div className="grid items-start gap-7 lg:grid-cols-2 lg:gap-10">
        <BookedRanges ranges={item.bookedRanges} today={today} />
        {!item.isOwn && <RequestCard item={item} today={today} />}
        {item.isOwn && (
          <Card className="flex flex-col items-start gap-3 p-6 sm:px-8 sm:py-7.5">
            <p className="font-bold">{itemPage.ownItem}</p>
            {item.status !== "retired" && (
              <ButtonLink href={`/my/items/${item.id}/edit`} variant="outline">
                {itemPage.edit}
              </ButtonLink>
            )}
          </Card>
        )}
      </div>
      {item.viewerCanRetireAsOrganizer && (
        <OrganizerRetireCard itemId={item.id} title={item.title} />
      )}
    </div>
  );
}
