import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { t } from "@/lib/text/interpolate";
import { loanStatus } from "@/lib/text/status";
import { loanCard } from "@/strings/loanCard";
import type { LoanCardDTO } from "@/types/loan";

const THUMB = "size-16 shrink-0 rounded-control object-cover";

type LoanCardProps = {
  loan: LoanCardDTO;
  dateRange: string;
  nextStep: string | null;
  headingLevel?: "h2" | "h3";
};

export default function LoanCard({
  loan,
  dateRange,
  nextStep,
  headingLevel: Heading = "h2",
}: LoanCardProps) {
  const party = t(loanCard.party[loan.side], {
    name: loan.otherPartyName,
    dateRange,
  });

  return (
    <Card className="flex gap-3 p-3">
      {/* The title sits beside the thumb, so the image adds no text. */}
      {loan.item.photo ? (
        <PhotoImage photo={loan.item.photo} alt="" className={THUMB} />
      ) : (
        <PhotoPlaceholder className={THUMB} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <Heading className="truncate text-lg font-bold">
              {loan.item.title}
            </Heading>
            {loan.changed && (
              <span className="inline-flex shrink-0 text-accent">
                <Icon name="dot" size={10} aria-hidden />
                <span className="sr-only">{loanCard.changed}</span>
              </span>
            )}
          </div>
          <StatusLabel status={loanStatus[loan.status]} />
        </div>
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-full truncate whitespace-nowrap text-sm text-muted">
            {party}
          </p>
          <ButtonLink
            href={`/loans/${loan.id}`}
            variant={loan.needsYou === null ? "outline" : "primary"}
            className="shrink-0"
          >
            {/* A list of cards would otherwise read as a column of identical links. */}
            {loanCard.openLoan}{" "}
            <span className="sr-only">{loan.item.title}</span>
          </ButtonLink>
        </div>
        {nextStep !== null && <p>{nextStep}</p>}
      </div>
    </Card>
  );
}
