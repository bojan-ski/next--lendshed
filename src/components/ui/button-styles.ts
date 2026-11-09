import { cn } from "@/lib/text/cn";

export type ButtonVariant = "primary" | "outline";

// Kept out of Button.tsx: a Server Component importing from a 'use client'
// file gets a reference, not this function.
export function buttonClasses(variant: ButtonVariant, className?: string) {
  return cn(
    "inline-flex h-12 items-center justify-center gap-2 rounded-control px-5 font-bold",
    "disabled:cursor-not-allowed disabled:opacity-60",
    variant === "primary"
      ? "bg-accent text-white hover:bg-accent-hover disabled:hover:bg-accent"
      : "border border-field bg-card text-ink",
    className,
  );
}
