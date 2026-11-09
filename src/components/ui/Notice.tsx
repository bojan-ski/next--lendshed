import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Icon } from "@/components/ui/icons";

type NoticeProps = {
  tone: "error" | "info";
  children: ReactNode;
  className?: string;
};

export default function Notice({ tone, children, className }: NoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : undefined}
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
