import Link from "next/link";
import Card from "@/components/ui/Card";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { t } from "@/lib/text/interpolate";
import { freeToday } from "@/lib/text/status";
import { itemCard } from "@/strings/itemCard";
import type { ItemCardDTO } from "@/types/item";

const PHOTO_BOX = "aspect-square w-full object-cover";

type ItemCardProps = {
  item: ItemCardDTO;
  headingLevel?: "h2" | "h3";
};

// The title inside the link names it, so the photo is decorative (alt "").
export default function ItemCard({ item, headingLevel = "h2" }: ItemCardProps) {
  const Heading = headingLevel;
  const meta =
    item.ownerArea === null
      ? item.ownerName
      : t(itemCard.meta, {
          ownerName: item.ownerName,
          ownerArea: item.ownerArea,
        });

  return (
    <Link href={`/items/${item.id}`} className="block rounded-card">
      <Card className="flex h-full flex-col overflow-hidden">
        {item.photo ? (
          <PhotoImage photo={item.photo} alt="" className={PHOTO_BOX} />
        ) : (
          <PhotoPlaceholder iconSize={48} className={PHOTO_BOX} />
        )}
        <div className="flex min-w-0 flex-col gap-1 p-3">
          <Heading className="truncate text-lg font-bold">{item.title}</Heading>
          <p className="truncate text-sm text-muted">{item.categoryName}</p>
          <p className="truncate whitespace-nowrap text-sm text-muted">
            {meta}
          </p>
          {item.freeToday && (
            <div className="pt-1">
              <StatusLabel status={freeToday} />
            </div>
          )}
        </div>
      </Card>
    </Link>
  );
}
