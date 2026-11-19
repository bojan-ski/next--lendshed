import Link from "next/link";
import type { MyLoansQuery } from "@/lib/schemas/loans";
import { cn } from "@/lib/text/cn";
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
    <nav aria-label={myLoans.tabsLabel} className="self-start">
      <ul className="flex flex-wrap gap-1.5 rounded-full bg-card p-1.5">
        {TABS.map((side) => (
          <li key={side}>
            <Link
              href={`/my/loans?tab=${side}`}
              aria-current={side === tab ? "page" : undefined}
              className={cn(
                "inline-flex min-h-11 items-center rounded-full px-5.5 motion-safe:transition-[background-color] motion-safe:duration-150",
                side === tab
                  ? "bg-accent font-bold text-page"
                  : "text-ink hover:bg-page",
              )}
            >
              {myLoans.tabs[side]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
