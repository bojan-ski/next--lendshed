import type { ClassValue } from "clsx";
import { cn } from "@/lib/text/cn";

// On a green card the field drops its border (add `border-transparent`).
export function controlClasses(...extra: ClassValue[]) {
  return cn(
    "w-full rounded-control border-[1.5px] border-field bg-card px-4 text-md text-ink",
    ...extra,
  );
}
