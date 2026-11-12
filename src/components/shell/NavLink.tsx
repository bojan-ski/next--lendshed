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
  const pathname = usePathname();
  const current = isCurrentPath(pathname, href, activePrefixes);

  // "page" only on the linked page; a page inside its section gets "true".
  return (
    <Link
      href={href}
      aria-current={current ? (pathname === href ? "page" : "true") : undefined}
      className={navLinkClasses(current)}
    >
      {children}
    </Link>
  );
}
