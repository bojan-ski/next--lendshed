import type { ReactNode } from "react";
import Card from "@/components/ui/Card";
import { cn } from "@/lib/text/cn";

// A detail-page card, labelled by its heading. The heading can take focus.
export default function MemberCard({
  id,
  heading,
  green = false,
  children,
}: {
  id: string;
  heading: string;
  green?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={cn(green && "surface-accent bg-accent")}>
      <section
        aria-labelledby={id}
        className="flex flex-col gap-4 p-6 sm:px-7.5 sm:py-7"
      >
        <h2 id={id} tabIndex={-1} className="type-section-title">
          {heading}
        </h2>
        {children}
      </section>
    </Card>
  );
}
