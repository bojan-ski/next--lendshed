import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import Container from "@/components/shell/Container";
import NavLabel from "@/components/shell/NavLabel";
import NavLink from "@/components/shell/NavLink";
import { navLinkClasses } from "@/components/shell/nav-styles";
import Wordmark from "@/components/shell/Wordmark";
import { nav } from "@/strings/nav";

type MemberHeaderProps = {
  avatar?: ReactNode;
  // Rendered inside the My loans link, after its label, so the count is part
  // of the link's accessible name.
  myLoansBadge?: ReactNode;
  // The last nav item, rendered as its own <li> (or nothing) by the slot.
  organizerEntry?: ReactNode;
};

export default function MemberHeader({
  avatar,
  myLoansBadge,
  organizerEntry,
}: MemberHeaderProps) {
  const entries = [
    { href: "/", label: nav.browse, activePrefixes: ["/items"] },
    {
      href: "/my/loans",
      label: nav.myLoans,
      activePrefixes: ["/my/loans", "/loans"],
      badge: myLoansBadge,
    },
    { href: "/my/items", label: nav.myItems, activePrefixes: ["/my/items"] },
  ];

  return (
    <header className="bg-card">
      <Container className="flex flex-wrap items-center gap-x-7 gap-y-2 py-3 lg:py-4">
        <Wordmark />
        <nav
          aria-label={nav.label}
          className="order-last w-full sm:order-none sm:w-auto"
        >
          <ul className="-mx-2.5 flex flex-wrap items-center gap-1 sm:mx-0 sm:gap-1.5">
            {entries.map((entry) => (
              <li key={entry.href}>
                {/* usePathname suspends on routes with unknown dynamic params. */}
                <Suspense
                  fallback={
                    <Link href={entry.href} className={navLinkClasses(false)}>
                      <NavLabel>{entry.label}</NavLabel>
                    </Link>
                  }
                >
                  <NavLink
                    href={entry.href}
                    activePrefixes={entry.activePrefixes}
                  >
                    <NavLabel>{entry.label}</NavLabel>
                    {entry.badge}
                  </NavLink>
                </Suspense>
              </li>
            ))}
            {organizerEntry}
          </ul>
        </nav>
        <div className="ml-auto">{avatar}</div>
      </Container>
    </header>
  );
}
