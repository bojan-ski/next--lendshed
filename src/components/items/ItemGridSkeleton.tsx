import { ITEM_GRID } from "@/components/items/ItemGrid";
import Card from "@/components/ui/Card";

// Card-shaped blocks in the grid's columns; Browse adds the search and chips.
export default function ItemGridSkeleton({
  withFilters = false,
}: {
  withFilters?: boolean;
}) {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {withFilters && (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="h-12 rounded-control bg-neutral-soft sm:flex-1" />
            <div className="h-12 rounded-control bg-neutral-soft sm:w-28" />
          </div>
          <div className="flex flex-wrap gap-2">
            {[0, 1, 2, 3].map((chip) => (
              <div
                key={chip}
                className="h-11 w-20 rounded-control bg-neutral-soft"
              />
            ))}
          </div>
          <div className="h-5 w-32 rounded-control bg-neutral-soft" />
        </>
      )}
      <div className={ITEM_GRID}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((card) => (
          <Card key={card} className="flex flex-col overflow-hidden">
            <div className="aspect-square w-full bg-neutral-soft" />
            <div className="flex flex-col gap-2 p-3">
              <div className="h-6 rounded-control bg-neutral-soft" />
              <div className="h-4 w-2/3 rounded-control bg-neutral-soft" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
