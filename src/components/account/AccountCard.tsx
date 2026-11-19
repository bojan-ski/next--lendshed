import type { ReactNode } from "react";
import Card from "@/components/ui/Card";

type AccountCardProps = {
  id: string;
  heading: string;
  children: ReactNode;
};

export default function AccountCard({
  id,
  heading,
  children,
}: AccountCardProps) {
  const headingId = `${id}-heading`;
  return (
    <Card
      role="region"
      aria-labelledby={headingId}
      className="flex flex-col gap-5 p-6 sm:px-8 sm:py-7.5"
    >
      <h2 id={headingId} className="type-section-title">
        {heading}
      </h2>
      {children}
    </Card>
  );
}
