import Link from "next/link";
import { navLinkClasses } from "@/components/shell/nav-styles";
import type { MyLoansQuery } from "@/lib/schemas/loans";
import { myLoans } from "@/strings/myLoans";
import type { LoanCardDTO } from "@/types/loan";

const TABS: LoanCardDTO["side"][] = ["borrowing", "lending"];

// Plain links, not ARIA tabs: each tab is its own URL.
export default function MyLoansTabs({
  tab,
}: {
  tab: NonNullable<MyLoansQuery["tab"]>;
}) {
  return (
    <nav aria-label={myLoans.tabsLabel}>
      <ul className="-mx-2 flex flex-wrap gap-x-2">
        {TABS.map((side) => (
          <li key={side}>
            <Link
              href={`/my/loans?tab=${side}`}
              aria-current={side === tab ? "page" : undefined}
              className={navLinkClasses(side === tab)}
            >
              {myLoans.tabs[side]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
