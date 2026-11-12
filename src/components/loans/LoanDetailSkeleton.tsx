import Card from "@/components/ui/Card";

// The heading, the dates line and item row, then the two cards.
export default function LoanDetailSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-9 w-56 rounded-control bg-neutral-soft" />
          <div className="h-7 w-24 rounded-full bg-neutral-soft" />
        </div>
        <div className="h-5 w-64 max-w-full rounded-control bg-neutral-soft" />
        <div className="flex items-center gap-4">
          <div className="size-24 shrink-0 rounded-control bg-neutral-soft" />
          <div className="h-5 w-40 rounded-control bg-neutral-soft" />
        </div>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-3 p-6">
          <div className="h-7 w-48 rounded-control bg-neutral-soft" />
          <div className="h-5 w-full rounded-control bg-neutral-soft" />
          <div className="h-5 w-3/4 rounded-control bg-neutral-soft" />
        </Card>
        <Card className="flex flex-col gap-3 p-6">
          <div className="h-7 w-40 rounded-control bg-neutral-soft" />
          <div className="h-16 rounded-control bg-neutral-soft" />
        </Card>
      </div>
    </div>
  );
}
