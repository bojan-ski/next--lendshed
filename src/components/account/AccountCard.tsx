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
      className="flex flex-col gap-4 p-6"
    >
      <h2 id={headingId} className="text-xl font-bold">
        {heading}
      </h2>
      {children}
    </Card>
  );
}
