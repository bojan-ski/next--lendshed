// The count line with Add item, then four white rows.
export default function OwnItemsTableSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="h-5 w-28 rounded-full bg-neutral-soft" />
        <div className="h-12 rounded-full bg-neutral-soft sm:w-36" />
      </div>
      <div className="flex flex-col gap-2.5 lg:pt-7.5">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex flex-col gap-2.5 rounded-tile bg-card p-4 lg:flex-row lg:items-center lg:gap-5 lg:px-5 lg:py-3.5"
          >
            <div className="flex items-center gap-4 lg:flex-1">
              <div className="size-15 shrink-0 rounded-thumb bg-neutral-soft" />
              <div className="h-6 flex-1 rounded-full bg-neutral-soft" />
            </div>
            <div className="h-7 w-1/2 rounded-full bg-neutral-soft lg:w-48" />
            <div className="h-11 rounded-full bg-neutral-soft lg:w-24" />
          </div>
        ))}
      </div>
    </div>
  );
}
