import Link from "next/link";
import { Suspense } from "react";
import Container from "@/components/shell/Container";
import NavLink from "@/components/shell/NavLink";
import { navLinkClasses } from "@/components/shell/nav-styles";
import Wordmark from "@/components/shell/Wordmark";
import { nav } from "@/strings/nav";

const entries = [{ href: "/", label: nav.browse, activePrefixes: ["/items"] }];

export default function MemberHeader() {
  return (
    <header className="border-b border-line bg-card">
      <Container className="flex flex-wrap items-center gap-x-6 py-2">
        <Wordmark />
        <nav
          aria-label={nav.label}
          className="order-last w-full sm:order-none sm:w-auto"
        >
          <ul className="-mx-2 flex flex-wrap items-center gap-x-2">
            {entries.map((entry) => (
              <li key={entry.href}>
                {/* usePathname suspends on routes with unknown dynamic params. */}
                <Suspense
                  fallback={
                    <Link href={entry.href} className={navLinkClasses(false)}>
                      {entry.label}
                    </Link>
                  }
                >
                  <NavLink
                    href={entry.href}
                    activePrefixes={entry.activePrefixes}
                  >
                    {entry.label}
                  </NavLink>
                </Suspense>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto" />
      </Container>
    </header>
  );
}
