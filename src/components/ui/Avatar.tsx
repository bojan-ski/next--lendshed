import type { ComponentProps } from "react";
import { cn } from "@/lib/text/cn";

type AvatarProps = ComponentProps<"span"> & { initials: string };

// Initials only, never a photo.
export default function Avatar({ initials, className, ...props }: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft font-bold text-accent",
        className,
      )}
      {...props}
    >
      {initials}
    </span>
  );
}
