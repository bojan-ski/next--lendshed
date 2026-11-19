import Card from "@/components/ui/Card";

// The heading row and four cards.
export default function MemberDetailSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="size-12 shrink-0 rounded-full bg-neutral-soft" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="h-8 w-1/2 rounded-control bg-neutral-soft" />
          <div className="h-5 w-3/4 rounded-control bg-neutral-soft" />
        </div>
      </div>
      {[0, 1, 2, 3].map((card) => (
        <Card key={card} className="flex flex-col gap-4 p-6 sm:px-8 sm:py-7.5">
          <div className="h-7 w-40 rounded-control bg-neutral-soft" />
          <div className="h-12 rounded-control bg-neutral-soft" />
        </Card>
      ))}
    </div>
  );
}
