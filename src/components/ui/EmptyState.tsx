import type { ReactNode } from "react";
import Card from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/icons";

type EmptyStateProps = {
  icon: IconName;
  heading: string;
  body: string;
  action?: ReactNode;
  // h3 when the empty state sits under a section's own h2.
  headingLevel?: "h2" | "h3";
};

export default function EmptyState({
  icon,
  heading,
  body,
  action,
  headingLevel: Heading = "h2",
}: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Icon name={icon} size={48} aria-hidden className="text-muted" />
      <Heading className="text-xl font-bold">{heading}</Heading>
      <p className="text-muted">{body}</p>
      {action}
    </Card>
  );
}
