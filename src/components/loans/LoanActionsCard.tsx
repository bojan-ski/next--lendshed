import CancelLoanControl from "@/components/loans/CancelLoanControl";
import HandOverControl from "@/components/loans/HandOverControl";
import LoanDecisionControls from "@/components/loans/LoanDecisionControls";
import MarkReturnedForm from "@/components/loans/MarkReturnedForm";
import OrganizerCloseForm from "@/components/loans/OrganizerCloseForm";
import Card from "@/components/ui/Card";
import Notice from "@/components/ui/Notice";
import { t } from "@/lib/text/interpolate";
import { loanActions } from "@/strings/loanActions";
import type { LoanDetailDTO } from "@/types/loan";

function headingFor(loan: LoanDetailDTO): string {
  if (loan.actions.includes("organizer_close")) return loanActions.headingClose;
  if (loan.actions.includes("mark_returned")) return loanActions.headingReturn;
  if (loan.status === "approved") return loanActions.headingLoan;
  return loanActions.heading;
}

// A control for each entry in `actions`, nothing else; the action re-checks
// whatever this showed. Only ids and the server's date bounds reach islands.
export default function LoanActionsCard({
  loan,
  today,
}: {
  loan: LoanDetailDTO;
  today: string;
}) {
  const count = loan.overlappingRequestCount;
  const deciding = loan.actions.includes("decline");
  const handOver = loan.actions.includes("hand_over");
  const cancel = loan.actions.includes("cancel");
  return (
    <Card className="flex flex-col gap-4.5 p-6 sm:px-8 sm:py-7.5">
      <h2 className="type-section-title">{headingFor(loan)}</h2>
      {loan.actions.includes("approve") && count > 0 && (
        <Notice tone="info">
          {count === 1
            ? loanActions.overlapOne
            : t(loanActions.overlapOther, { count })}
        </Notice>
      )}
      {loan.handOverBlocked && (
        <Notice tone="info">{loanActions.notBack}</Notice>
      )}
      {deciding && (
        <LoanDecisionControls
          loanId={loan.id}
          canApprove={loan.actions.includes("approve")}
        />
      )}
      {(handOver || cancel) && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          {handOver && <HandOverControl loanId={loan.id} />}
          {cancel && (
            <div className="min-w-0 sm:flex-1">
              <CancelLoanControl
                loanId={loan.id}
                stage={loan.status === "requested" ? "request" : "loan"}
              />
            </div>
          )}
        </div>
      )}
      {loan.actions.includes("mark_returned") && (
        <MarkReturnedForm
          loanId={loan.id}
          minDate={loan.startDate}
          maxDate={today}
        />
      )}
      {loan.actions.includes("organizer_close") && (
        <>
          <p className="text-sm text-muted">{loanActions.closeWhen}</p>
          <OrganizerCloseForm
            loanId={loan.id}
            minDate={loan.startDate}
            maxDate={today}
          />
        </>
      )}
    </Card>
  );
}
