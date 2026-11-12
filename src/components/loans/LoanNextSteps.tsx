import Card from "@/components/ui/Card";
import { formatDate } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { loanStatus } from "@/lib/text/status";
import { loanPage } from "@/strings/loanPage";
import type { LoanDetailDTO } from "@/types/loan";

type LoanNextStepsProps = { loan: LoanDetailDTO; today: string };

type OpenStatus = keyof typeof loanPage.steps;

const isOpen = (status: LoanDetailDTO["status"]): status is OpenStatus =>
  status in loanPage.steps;

// "you" when the viewer is the one who ended it.
function actorName(loan: LoanDetailDTO): string | null {
  switch (loan.endedBy) {
    case "owner":
      return loan.viewerRole === "owner"
        ? loanPage.you
        : loan.owner.displayName;
    case "borrower":
      return loan.viewerRole === "borrower"
        ? loanPage.you
        : loan.borrower.displayName;
    case "organizer":
      return loanPage.anOrganizer;
    default:
      return null;
  }
}

function endedLines(loan: LoanDetailDTO, today: string): string[] {
  const reason = loan.systemReason && loanPage.reasons[loan.systemReason];
  switch (loan.status) {
    case "returned":
      return [
        loan.returnedOn
          ? t(loanPage.ended.returned, {
              date: formatDate(loan.returnedOn, today),
            })
          : loanStatus.returned.label,
        ...(loan.returnedAsLent === "no" ? [loanPage.ended.notAsLent] : []),
        ...(loan.closedByName
          ? [t(loanPage.ended.closedBy, { name: loan.closedByName })]
          : []),
      ];
    case "declined":
    case "cancelled": {
      if (loan.endedBy === "system") {
        const auto =
          loan.status === "declined"
            ? loanPage.ended.declinedAuto
            : loanPage.ended.cancelledAuto;
        return [t(auto, { reason: reason ?? "" }).trim()];
      }
      const actor = actorName(loan);
      const line = actor
        ? t(loanPage.ended[loan.status], { actor })
        : loanStatus[loan.status].label;
      return reason ? [line, reason] : [line];
    }
    case "expired":
    case "lapsed":
      return [loanPage.ended[loan.status]];
    default:
      return [];
  }
}

export default function LoanNextSteps({ loan, today }: LoanNextStepsProps) {
  const names = {
    owner: loan.owner.displayName,
    borrower: loan.borrower.displayName,
    end: formatDate(loan.endDate, today),
    due: formatDate(loan.endDate, today),
  };

  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-xl font-bold">{loanPage.nextHeading}</h2>
      {isOpen(loan.status) ? (
        <ol className="flex flex-col gap-2">
          {loanPage.steps[loan.status][loan.viewerRole].map((step, index) => (
            <li key={step} className="flex gap-3">
              <span aria-hidden className="shrink-0 font-bold text-accent">
                {index + 1}
              </span>
              <span className="min-w-0 wrap-break-word">{t(step, names)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <div className="flex flex-col gap-2">
          {endedLines(loan, today).map((line) => (
            <p key={line} className="text-muted">
              {line}
            </p>
          ))}
          {loan.statusReason && (
            <p className="whitespace-pre-line wrap-break-word text-ink">
              {t(loanPage.reasonQuote, { reason: loan.statusReason })}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
