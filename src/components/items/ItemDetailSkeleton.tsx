import Card from "@/components/ui/Card";

// The photo and details side by side, then the booked card.
export default function ItemDetailSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="aspect-square w-full rounded-card bg-neutral-soft" />
        <div className="flex flex-col gap-4">
          <div className="h-9 w-3/4 rounded-control bg-neutral-soft" />
          <div className="flex gap-2">
            <div className="h-7 w-20 rounded-full bg-neutral-soft" />
            <div className="h-7 w-32 rounded-full bg-neutral-soft" />
          </div>
          <div className="h-5 w-1/2 rounded-control bg-neutral-soft" />
          <div className="flex items-center gap-3">
            <div className="size-10 shrink-0 rounded-full bg-neutral-soft" />
            <div className="h-5 w-40 rounded-control bg-neutral-soft" />
          </div>
          <div className="h-16 rounded-control bg-neutral-soft" />
        </div>
      </div>
      <Card className="flex flex-col gap-3 p-6 sm:px-8 sm:py-7.5 lg:w-1/2">
        <div className="h-7 w-40 rounded-control bg-neutral-soft" />
        <div className="h-5 w-48 rounded-control bg-neutral-soft" />
      </Card>
    </div>
  );
}
