import type { ComponentProps } from "react";
import { cn } from "@/lib/text/cn";
import { hueStyle, type Hue } from "@/lib/text/hue";

type AvatarProps = ComponentProps<"span"> & { initials: string; hue?: Hue };

// Initials only, never a photo. With a hue, the person's own tint.
export default function Avatar({
  initials,
  hue,
  className,
  style,
  ...props
}: AvatarProps) {
  return (
    <span
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full font-bold",
        hue === undefined
          ? "bg-accent-soft text-accent-ink"
          : "bg-hue-tint text-ink",
        className,
      )}
      style={hue === undefined ? style : { ...hueStyle(hue), ...style }}
      {...props}
    >
      {initials}
    </span>
  );
}
