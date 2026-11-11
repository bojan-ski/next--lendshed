import ItemCard from "@/components/items/ItemCard";
import type { ItemCardDTO } from "@/types/item";

export const ITEM_GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4";

type ItemGridProps = {
  items: ItemCardDTO[];
  headingLevel?: "h2" | "h3";
};

export default function ItemGrid({ items, headingLevel }: ItemGridProps) {
  return (
    <ul className={ITEM_GRID}>
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <ItemCard item={item} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}
