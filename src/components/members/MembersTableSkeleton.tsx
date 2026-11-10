import Card from "@/components/ui/Card";

// The search field, the count line and four rows.
export default function MembersTableSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5 sm:flex-1">
          <div className="h-6 w-32 rounded-control bg-neutral-soft" />
          <div className="h-12 rounded-control bg-neutral-soft" />
        </div>
        <div className="h-12 rounded-control bg-neutral-soft sm:w-28" />
      </div>
      <div className="h-5 w-24 rounded-control bg-neutral-soft" />
      <Card className="flex flex-col gap-4 p-4">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4"
          >
            <div className="flex items-center gap-3 sm:flex-1">
              <div className="size-10 shrink-0 rounded-full bg-neutral-soft" />
              <div className="h-6 flex-1 rounded-control bg-neutral-soft" />
            </div>
            <div className="h-6 w-1/2 rounded-control bg-neutral-soft sm:w-40" />
            <div className="h-12 rounded-control bg-neutral-soft sm:w-24" />
          </div>
        ))}
      </Card>
    </div>
  );
}
