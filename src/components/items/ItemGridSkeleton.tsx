import BrowseHero from "@/components/browse/BrowseHero";
import { ITEM_GRID } from "@/components/items/ItemGrid";

const BLOCK = "rounded-full bg-neutral-soft";

// Card-shaped blocks in the grid's columns. Browse adds its hero (the real
// heading, a placeholder search) and the chips.
export default function ItemGridSkeleton({
  withFilters = false,
}: {
  withFilters?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4.5">
      {withFilters && (
        <BrowseHero
          search={
            <div aria-hidden className="h-15 rounded-full bg-card opacity-30" />
          }
        />
      )}
      <div aria-hidden className="flex flex-col gap-4.5">
        {withFilters && (
          <>
            <div className="flex flex-wrap gap-2.5">
              {[0, 1, 2, 3, 4, 5].map((chip) => (
                <div key={chip} className={`h-11 w-24 ${BLOCK}`} />
              ))}
            </div>
            <div className={`h-5 w-32 ${BLOCK}`} />
          </>
        )}
        <div className={ITEM_GRID}>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((card) => (
            <div
              key={card}
              className="flex flex-col overflow-hidden rounded-tile bg-card"
            >
              <div className="aspect-square w-full bg-neutral-soft" />
              {/* Title, category chip, owner line: the loaded card's body. */}
              <div className="flex flex-col gap-1.5 px-4 pt-3.5 pb-4.5">
                <div className={`h-6 ${BLOCK}`} />
                <div className={`h-5.5 w-16 ${BLOCK}`} />
                <div className={`h-5 w-2/3 ${BLOCK}`} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
