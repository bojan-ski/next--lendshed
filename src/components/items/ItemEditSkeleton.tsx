import Card from "@/components/ui/Card";
import { cn } from "@/lib/text/cn";

// The title with its label, then the four cards: a line and a control each,
// with the details card taller.
const CARDS = ["h-12", "h-40", "h-96", "h-12"];

export default function ItemEditSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <div className="h-8 w-48 rounded-control bg-neutral-soft" />
        <div className="h-7 w-20 rounded-full bg-neutral-soft" />
      </div>
      {CARDS.map((height, card) => (
        <Card key={card} className="flex flex-col gap-4 p-6">
          <div className="h-7 w-32 rounded-control bg-neutral-soft" />
          <div className={cn("rounded-control bg-neutral-soft", height)} />
        </Card>
      ))}
    </div>
  );
}
