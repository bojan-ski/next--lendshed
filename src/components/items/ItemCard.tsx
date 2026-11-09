import Link from "next/link";
import Card from "@/components/ui/Card";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { t } from "@/lib/interpolate";
import { freeToday } from "@/lib/status";
import { itemCard } from "@/strings/itemCard";
import type { ItemCardDTO } from "@/types/item";

export default function ItemCard({ item }: { item: ItemCardDTO }) {
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
        <PhotoPlaceholder iconSize={48} className="aspect-square w-full" />
        <div className="flex min-w-0 flex-col gap-1 p-3">
          <h2 className="truncate text-lg font-bold">{item.title}</h2>
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
