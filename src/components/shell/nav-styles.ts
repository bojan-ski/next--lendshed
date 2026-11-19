import { cn } from "@/lib/text/cn";

// Nav items are pills; the current one is filled.
export function navLinkClasses(current: boolean, className?: string) {
  return cn(
    "inline-flex min-h-11 items-center rounded-full px-4 motion-safe:transition-[background-color] motion-safe:duration-150",
    current
      ? "bg-accent-soft font-bold text-accent-ink"
      : "text-ink hover:bg-page",
    className,
  );
}

export function isCurrentPath(
  pathname: string,
  href: string,
  activePrefixes: readonly string[] = [],
) {
  return (
    pathname === href ||
    activePrefixes.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  );
}
