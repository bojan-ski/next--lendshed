import type { ReactNode } from "react";
import Card from "@/components/ui/Card";
import { Icon, type IconName } from "@/components/ui/icons";

type EmptyStateProps = {
  icon: IconName;
  heading: string;
  body: string;
  action?: ReactNode;
};

export default function EmptyState({
  icon,
  heading,
  body,
  action,
}: EmptyStateProps) {
  return (
    <Card className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <Icon name={icon} size={48} aria-hidden className="text-muted" />
      <h2 className="text-xl font-bold">{heading}</h2>
      <p className="text-muted">{body}</p>
      {action}
    </Card>
  );
}
