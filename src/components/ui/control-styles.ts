import type { ClassValue } from "clsx";
import { cn } from "@/lib/cn";

export function controlClasses(...extra: ClassValue[]) {
  return cn(
    "w-full rounded-control border border-field bg-card px-3 text-base text-ink",
    ...extra,
  );
}
