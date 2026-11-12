import CancelLoanControl from "@/components/loans/CancelLoanControl";
import LoanDecisionControls from "@/components/loans/LoanDecisionControls";
import Card from "@/components/ui/Card";
import Notice from "@/components/ui/Notice";
import { t } from "@/lib/text/interpolate";
import { loanActions } from "@/strings/loanActions";
import type { LoanDetailDTO } from "@/types/loan";

// A control for each entry in `actions`, nothing else; the action re-checks
// whatever this showed.
export default function LoanActionsCard({ loan }: { loan: LoanDetailDTO }) {
  const count = loan.overlappingRequestCount;
  const deciding = loan.actions.includes("decline");
  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-xl font-bold">{loanActions.heading}</h2>
      {loan.actions.includes("approve") && count > 0 && (
        <Notice tone="info">
          {count === 1
            ? loanActions.overlapOne
            : t(loanActions.overlapOther, { count })}
        </Notice>
      )}
      {deciding && (
        <LoanDecisionControls
          loanId={loan.id}
          canApprove={loan.actions.includes("approve")}
        />
      )}
      {loan.actions.includes("cancel") && (
        <CancelLoanControl
          loanId={loan.id}
          stage={loan.status === "requested" ? "request" : "loan"}
        />
      )}
    </Card>
  );
}
