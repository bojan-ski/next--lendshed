import Card from "@/components/ui/Card";

export default function CategoriesTableSkeleton() {
  return (
    <Card aria-hidden className="flex flex-col gap-4 p-4">
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-2 lg:flex-row lg:gap-4">
          <div className="h-6 rounded-control bg-neutral-soft lg:flex-1" />
          <div className="h-12 rounded-control bg-neutral-soft lg:w-56" />
        </div>
      ))}
    </Card>
  );
}
