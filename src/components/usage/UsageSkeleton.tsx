import Card from "@/components/ui/Card";

export default function UsageSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      <div className="h-6 w-56 max-w-full rounded-control bg-neutral-soft" />
      <div className="grid gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((row) => (
          <Card key={row} className="flex flex-col gap-3 p-4">
            <div className="h-6 w-32 rounded-control bg-neutral-soft" />
            <div className="h-7 w-40 rounded-control bg-neutral-soft" />
            <div className="h-2 rounded-full bg-neutral-soft" />
          </Card>
        ))}
      </div>
      <div className="h-24 rounded-card bg-neutral-soft" />
    </div>
  );
}
