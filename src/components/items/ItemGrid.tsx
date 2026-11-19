import ItemCard from "@/components/items/ItemCard";
import type { Hue } from "@/lib/text/hue";
import type { ItemCardDTO } from "@/types/item";

export const ITEM_GRID =
  "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5";

type ItemGridProps = {
  items: ItemCardDTO[];
  // categoryHues(await getCategories())
  categoryHues: ReadonlyMap<string, Hue>;
  headingLevel?: "h2" | "h3";
};

export default function ItemGrid({
  items,
  categoryHues,
  headingLevel,
}: ItemGridProps) {
  return (
    <ul className={ITEM_GRID}>
      {items.map((item) => (
        <li key={item.id} className="min-w-0">
          <ItemCard
            item={item}
            hue={categoryHues.get(item.categoryId)}
            headingLevel={headingLevel}
          />
        </li>
      ))}
    </ul>
  );
}
