import type { ComponentProps } from "react";
import { cn } from "@/lib/text/cn";

// White on the page, no border and no shadow.
export default function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("rounded-card bg-card", className)} {...props} />;
}
