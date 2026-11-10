import type { ReactNode } from "react";
import Card from "@/components/ui/Card";

// A detail-page card, labelled by its heading. The heading can take focus.
export default function MemberCard({
  id,
  heading,
  children,
}: {
  id: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <Card>
      <section aria-labelledby={id} className="flex flex-col gap-4 p-6">
        <h2 id={id} tabIndex={-1} className="text-xl font-bold">
          {heading}
        </h2>
        {children}
      </section>
    </Card>
  );
}
