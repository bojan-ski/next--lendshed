import ItemGridSkeleton from "@/components/items/ItemGridSkeleton";

// The header row, the section heading, then the grid.
export default function MemberProfileSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex items-center gap-6 rounded-band bg-neutral-soft p-6 sm:px-12 sm:py-10">
        <div className="size-16 shrink-0 rounded-full bg-card sm:size-24" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-12 w-1/2 rounded-control bg-card" />
          <div className="h-6 w-1/4 rounded-control bg-card" />
        </div>
      </div>
      <div className="h-7 w-36 rounded-control bg-neutral-soft" />
      <ItemGridSkeleton />
    </div>
  );
}
