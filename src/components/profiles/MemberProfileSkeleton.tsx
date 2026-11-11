import ItemGridSkeleton from "@/components/items/ItemGridSkeleton";

// The header row, the section heading, then the grid.
export default function MemberProfileSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="size-12 shrink-0 rounded-full bg-neutral-soft" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-8 w-1/2 rounded-control bg-neutral-soft" />
          <div className="h-5 w-1/4 rounded-control bg-neutral-soft" />
        </div>
      </div>
      <div className="h-7 w-36 rounded-control bg-neutral-soft" />
      <ItemGridSkeleton />
    </div>
  );
}
