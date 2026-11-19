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
    <Card className="flex flex-col items-center gap-3.5 rounded-band px-6 py-12 text-center sm:px-8 sm:py-14">
      <span className="flex size-22 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon name={icon} size={44} aria-hidden />
      </span>
      <Heading className="font-display text-4xl font-extrabold">
        {heading}
      </Heading>
      <p className="text-muted">{body}</p>
      {action && <div className="mt-1.5">{action}</div>}
    </Card>
  );
}
