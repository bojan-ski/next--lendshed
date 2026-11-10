import Card from "@/components/ui/Card";
import { cn } from "@/lib/text/cn";

// Fields per card: profile, contact details, change password, sign out.
const CARDS = [2, 1, 2, 0];

export default function AccountSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      {CARDS.map((fields, card) => (
        <Card key={card} className="flex flex-col gap-4 p-6">
          <div className="h-7 w-40 rounded-control bg-neutral-soft" />
          {Array.from({ length: fields }, (_, field) => (
            <div key={field} className="flex flex-col gap-1.5">
              <div className="h-6 w-32 rounded-control bg-neutral-soft" />
              <div
                className={cn(
                  "rounded-control bg-neutral-soft",
                  fields === 1 ? "h-32" : "h-12",
                )}
              />
            </div>
          ))}
          <div className="h-12 rounded-control bg-neutral-soft sm:w-48" />
        </Card>
      ))}
    </div>
  );
}
