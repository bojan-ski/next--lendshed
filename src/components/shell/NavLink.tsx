"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { isCurrentPath, navLinkClasses } from "@/components/shell/nav-styles";

type NavLinkProps = {
  href: string;
  activePrefixes?: readonly string[];
  children: ReactNode;
};

export default function NavLink({
  href,
  activePrefixes,
  children,
}: NavLinkProps) {
  const current = isCurrentPath(usePathname(), href, activePrefixes);

  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={navLinkClasses(current)}
    >
      {children}
    </Link>
  );
}
