import Link from "next/link";
import FreeToday from "@/components/items/FreeToday";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import { cn } from "@/lib/text/cn";
import { hueStyle, type Hue } from "@/lib/text/hue";
import { t } from "@/lib/text/interpolate";
import { itemCard } from "@/strings/itemCard";
import type { ItemCardDTO } from "@/types/item";

const PHOTO_BOX = "aspect-square w-full object-cover";

type ItemCardProps = {
  item: ItemCardDTO;
  // The category's hue (categoryHues); without one the chip is neutral.
  hue?: Hue;
  headingLevel?: "h2" | "h3";
};

// The title inside the link names it, so the photo is decorative (alt "").
export default function ItemCard({
  item,
  hue,
  headingLevel = "h2",
}: ItemCardProps) {
  const Heading = headingLevel;
  const meta =
    item.ownerArea === null
      ? item.ownerName
      : t(itemCard.meta, {
          ownerName: item.ownerName,
          ownerArea: item.ownerArea,
        });

  return (
    <Link
      href={`/items/${item.id}`}
      className="flex h-full flex-col overflow-hidden rounded-tile bg-card"
    >
      {item.photo ? (
        <PhotoImage photo={item.photo} alt="" className={PHOTO_BOX} hue={hue} />
      ) : (
        <PhotoPlaceholder iconSize={48} className={PHOTO_BOX} hue={hue} />
      )}
      <div className="flex min-w-0 flex-col gap-1.5 px-4 pt-3.5 pb-4.5">
        <Heading className="truncate type-card-title">{item.title}</Heading>
        <p
          style={hue === undefined ? undefined : hueStyle(hue)}
          className={cn(
            "max-w-full self-start truncate rounded-full px-2.5 py-0.5 text-xs font-bold",
            hue === undefined
              ? "bg-neutral-soft text-ink"
              : "bg-hue-soft text-hue-ink",
          )}
        >
          {item.categoryName}
        </p>
        <p className="truncate whitespace-nowrap text-sm text-muted">{meta}</p>
        {item.freeToday && <FreeToday className="mt-1" />}
      </div>
    </Link>
  );
}
