import type { ReactNode } from "react";
import { cn } from "@/lib/text/cn";
import { Icon } from "@/components/ui/icons";

type NoticeProps = {
  tone: "error" | "info";
  children: ReactNode;
  className?: string;
  // Off where focus moves to the content instead (it would be read twice).
  alert?: boolean;
};

export default function Notice({
  tone,
  children,
  className,
  alert = tone === "error",
}: NoticeProps) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2 bg-notice text-ink",
        tone === "error"
          ? "rounded-control border-l-[3px] border-ink p-3"
          : "rounded-card p-4",
        className,
      )}
    >
      <Icon
        name={tone === "error" ? "alert" : "info"}
        aria-hidden
        className="mt-0.5 shrink-0"
      />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
