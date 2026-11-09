import { cn } from "@/lib/cn";

export function navLinkClasses(current: boolean) {
  return cn(
    "inline-flex min-h-11 items-center px-2 font-bold",
    current ? "text-accent underline underline-offset-4" : "text-ink",
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
