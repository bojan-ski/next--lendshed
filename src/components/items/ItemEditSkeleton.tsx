import { cn } from "@/lib/text/cn";

const BLOCK = "rounded-control bg-neutral-soft";
const CARD = "flex flex-col gap-4 rounded-card bg-card p-6 sm:px-8 sm:py-7.5";

// The title with its label, then the cards in the edit page's grid: the
// visibility, photo and remove cards on the left, the taller details card
// on the right from 1024 px.
export default function ItemEditSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className={cn(BLOCK, "h-12 w-56")} />
        <div className="h-7 w-20 rounded-full bg-neutral-soft" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start lg:gap-7">
        <div className="flex flex-col gap-6">
          {["h-12", "h-36", "h-12"].map((height, card) => (
            <div key={card} className={CARD}>
              <div className={cn(BLOCK, "h-7 w-32")} />
              <div className={cn(BLOCK, height)} />
            </div>
          ))}
        </div>
        <div className={CARD}>
          <div className={cn(BLOCK, "h-7 w-32")} />
          <div className={cn(BLOCK, "h-96")} />
        </div>
      </div>
    </div>
  );
}
