import Link from "next/link";
import StatusLabel from "@/components/ui/StatusLabel";
import { formatDate } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { loanStatus } from "@/lib/text/status";
import { members } from "@/strings/members";
import type { AdminMemberOpenLoan } from "@/types/members";

// The "Loans still open" card body: each row opens the loan page.
export default function MemberOpenLoans({
  loans,
  suspended,
  today,
}: {
  loans: AdminMemberOpenLoan[];
  suspended: boolean;
  today: string;
}) {
  if (loans.length === 0) {
    return <p className="text-muted">{members.noOpenLoans}</p>;
  }

  return (
    <>
      <ul className="flex flex-col">
        {loans.map((loan) => (
          <li key={loan.id} className="border-t border-line first:border-t-0">
            <Link
              href={`/loans/${loan.id}`}
              className="flex min-h-11 flex-col gap-1 py-3"
            >
              <span className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span className="truncate text-base font-bold">
                  {loan.itemTitle}
                </span>
                <span className="shrink-0">
                  <StatusLabel status={loanStatus[loan.status]} />
                </span>
              </span>
              <span className="text-sm text-muted wrap-break-word">
                {t(
                  loan.side === "lent" ? members.lentTo : members.borrowedFrom,
                  {
                    name: loan.otherPartyName,
                  },
                )}
                {" · "}
                {t(members.until, { date: formatDate(loan.endDate, today) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {suspended && (
        <p className="text-sm text-muted">{members.awaitsOrganizerClose}</p>
      )}
    </>
  );
}
