import Card from "@/components/ui/Card";

// The count line with Add item, then four rows.
export default function OwnItemsTableSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="h-5 w-28 rounded-control bg-neutral-soft" />
        <div className="h-12 rounded-control bg-neutral-soft sm:w-36" />
      </div>
      <Card className="flex flex-col gap-4 p-4">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4"
          >
            <div className="flex items-center gap-3 lg:flex-1">
              <div className="size-12 shrink-0 rounded-control bg-neutral-soft" />
              <div className="h-6 flex-1 rounded-control bg-neutral-soft" />
            </div>
            <div className="h-6 w-1/2 rounded-control bg-neutral-soft lg:w-48" />
            <div className="h-12 rounded-control bg-neutral-soft lg:w-24" />
          </div>
        ))}
      </Card>
    </div>
  );
}
