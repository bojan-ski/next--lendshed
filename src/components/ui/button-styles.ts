import { cn } from "@/lib/text/cn";

export type ButtonVariant = "primary" | "outline";

// Kept out of Button.tsx: a Server Component importing from a 'use client'
// file gets a reference, not this function.
export function buttonClasses(variant: ButtonVariant, className?: string) {
  return cn(
    "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 text-md font-bold motion-safe:transition-[background-color] motion-safe:duration-150",
    "disabled:cursor-not-allowed disabled:opacity-60",
    variant === "primary"
      ? "bg-primary text-ink hover:bg-primary-hover disabled:hover:bg-primary"
      : "border-2 border-ink bg-card text-ink hover:bg-page disabled:hover:bg-card",
    className,
  );
}
