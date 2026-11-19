import Card from "@/components/ui/Card";

// The two tab links, one group heading, then three cards.
export default function MyLoansSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex gap-1.5 self-start rounded-full bg-card p-1.5">
        <div className="h-11 w-28 rounded-full bg-neutral-soft" />
        <div className="h-11 w-24 rounded-full bg-neutral-soft" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="h-7 w-32 rounded-control bg-neutral-soft" />
        {[0, 1, 2].map((card) => (
          <Card key={card} className="flex gap-4 rounded-tile p-4">
            <div className="size-18 shrink-0 rounded-thumb bg-neutral-soft" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="h-6 w-1/2 rounded-control bg-neutral-soft" />
              <div className="h-5 w-3/4 rounded-control bg-neutral-soft" />
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
