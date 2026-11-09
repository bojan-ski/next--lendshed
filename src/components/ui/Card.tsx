import type { ComponentProps } from "react";
import { cn } from "@/lib/text/cn";

export default function Card({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-card border border-line bg-card", className)}
      {...props}
    />
  );
}
