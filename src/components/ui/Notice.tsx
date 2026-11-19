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
        // Its own focus ring, also inside a green card.
        "flex items-start gap-3 rounded-tile bg-notice px-5 py-4 text-ink [--focus-ring:var(--color-accent)]",
        tone === "error" && "border-2 border-ink",
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
