import Link from "next/link";
import { notFound } from "next/navigation";
import { LOAN_HEADING_ID } from "@/components/loans/ids";
import LoanActionsCard from "@/components/loans/LoanActionsCard";
import LoanContactCard from "@/components/loans/LoanContactCard";
import LoanNextSteps from "@/components/loans/LoanNextSteps";
import Card from "@/components/ui/Card";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { getLoanForViewer } from "@/data/loans";
import { requireViewer } from "@/lib/auth/guards";
import { communityToday, formatDateRange } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { loanStatus } from "@/lib/text/status";
import { loanPage } from "@/strings/loanPage";
import type { LoanDetailDTO } from "@/types/loan";

const THUMBNAIL = "size-24 shrink-0 rounded-control object-cover";

function DatesLine({ loan, today }: { loan: LoanDetailDTO; today: string }) {
  const names = {
    owner: loan.owner.displayName,
    borrower: loan.borrower.displayName,
  };
  return (
    <p className="flex min-w-0 flex-wrap items-center gap-x-2">
      <span>
        {formatDateRange(loan.startDate, loan.endDate, today)}{" "}
        {loan.lengthDays === 1
          ? loanPage.lengthOne
          : t(loanPage.lengthOther, { days: loan.lengthDays })}
      </span>
      <span className="max-w-full min-w-0 truncate">
        {t(loanPage.partyLine, {
          party: t(loanPage.party[loan.viewerRole], names),
        })}
      </span>
    </p>
  );
}

// The title links only where /items/[id] would show the item to this viewer.
function ItemRow({ item }: { item: LoanDetailDTO["item"] }) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      {item.photo ? (
        <PhotoImage photo={item.photo} alt="" className={THUMBNAIL} />
      ) : (
        <PhotoPlaceholder className={THUMBNAIL} />
      )}
      {item.viewable ? (
        <Link
          href={`/items/${item.id}`}
          className="inline-flex min-h-11 min-w-0 items-center font-bold wrap-break-word text-accent underline underline-offset-4"
        >
          {item.title}
        </Link>
      ) : (
        <p className="min-w-0 font-bold wrap-break-word">{item.title}</p>
      )}
    </div>
  );
}

function MessageCard({ loan }: { loan: LoanDetailDTO }) {
  return (
    <Card className="flex min-w-0 flex-col gap-3 p-6">
      <h2 className="truncate text-xl font-bold">
        {loan.viewerRole === "borrower"
          ? loanPage.messageBorrower
          : t(loanPage.messageOther, { borrower: loan.borrower.displayName })}
      </h2>
      <p className="whitespace-pre-line wrap-break-word">
        {loan.requestMessage}
      </p>
    </Card>
  );
}

// Guards itself: soft navigations don't re-run the layout. Anything outside
// the loan scope is not-found, whatever the reason. Reads params, so Partial
// Prefetching never renders it, and a prefetch never records a view.
export default async function LoanDetailSection({
  params,
}: Pick<PageProps<"/loans/[id]">, "params">) {
  const viewer = await requireViewer();
  const today = communityToday();
  const { id } = await params;
  const loan = await getLoanForViewer(viewer, id, today);
  if (!loan) notFound();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1
            id={LOAN_HEADING_ID}
            tabIndex={-1}
            className="min-w-0 text-3xl font-bold wrap-break-word"
          >
            {loan.item.title}
          </h1>
          <StatusLabel status={loanStatus[loan.status]} />
        </div>
        <DatesLine loan={loan} today={today} />
        <ItemRow item={loan.item} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          {loan.actions.length > 0 && <LoanActionsCard loan={loan} />}
          <LoanNextSteps loan={loan} today={today} />
          {loan.requestMessage !== null && <MessageCard loan={loan} />}
        </div>
        {loan.contact && (
          <div className="min-w-0">
            <LoanContactCard contact={loan.contact} />
          </div>
        )}
      </div>
    </div>
  );
}
