import { cn } from "@/lib/text/cn";
import { freeToday } from "@/lib/text/status";

// A green dot and the words: on a white card, not a pill.
export default function FreeToday({ className }: { className?: string }) {
  return (
    <p
      className={cn(
        "flex items-center gap-2 text-sm font-bold text-accent-ink",
        className,
      )}
    >
      <span aria-hidden className="size-2 shrink-0 rounded-full bg-free" />
      {freeToday.label}
    </p>
  );
}
