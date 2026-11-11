import Card from "@/components/ui/Card";
import { cn } from "@/lib/text/cn";

// The step line, then the six fields (two of them text areas) and the button.
const FIELDS = ["h-12", "h-12", "h-12", "h-12", "h-32", "h-24"];

export default function ItemFormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="h-6 w-40 rounded-control bg-neutral-soft" />
      <Card className="flex flex-col gap-4 p-4 sm:p-6">
        {FIELDS.map((height, field) => (
          <div key={field} className="flex flex-col gap-1.5">
            <div className="h-6 w-32 rounded-control bg-neutral-soft" />
            <div className={cn("rounded-control bg-neutral-soft", height)} />
          </div>
        ))}
        <div className="h-12 rounded-control bg-neutral-soft sm:w-48" />
      </Card>
    </div>
  );
}
