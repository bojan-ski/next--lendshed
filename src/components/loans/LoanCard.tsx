import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { loanStatus } from "@/lib/text/status";
import { loanCard } from "@/strings/loanCard";
import type { LoanCardDTO } from "@/types/loan";

const THUMB = "size-18 shrink-0 rounded-thumb object-cover";

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
  // The name may truncate (names never wrap); the dates never do, so on a
  // narrow card they move to their own line instead of being cut.
  const [lead, tail] = loanCard.party[loan.side].split("{dateRange}");
  const party = t(lead, { name: loan.otherPartyName }).trimEnd();

  return (
    <Card className="flex gap-4 rounded-tile p-4 sm:gap-4.5">
      {/* The title sits beside the thumb, so the image adds no text. */}
      {loan.item.photo ? (
        <PhotoImage photo={loan.item.photo} alt="" className={THUMB} />
      ) : (
        <PhotoPlaceholder className={THUMB} />
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 max-w-full items-center gap-2">
            <Heading className="truncate type-card-title">
              {loan.item.title}
            </Heading>
            {loan.changed && (
              <span className="inline-flex shrink-0">
                <span aria-hidden className="size-2.5 rounded-full bg-accent" />
                <span className="sr-only">{loanCard.changed}</span>
              </span>
            )}
          </div>
          <StatusLabel status={loanStatus[loan.status]} />
        </div>
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="min-w-0 max-w-full text-sm text-muted">
            <span className="inline-block max-w-full truncate align-bottom">
              {party}
            </span>{" "}
            <span className="inline-block whitespace-nowrap">
              {dateRange}
              {tail}
            </span>
          </p>
          <ButtonLink
            href={`/loans/${loan.id}`}
            variant={loan.needsYou === null ? "outline" : "primary"}
            className="shrink-0 px-5"
          >
            {/* A list of cards would otherwise read as a column of identical links. */}
            {loanCard.openLoan}{" "}
            <span className="sr-only">{loan.item.title}</span>
          </ButtonLink>
        </div>
        {nextStep !== null && (
          <p
            className={cn(
              "rounded-control px-3.5 py-2.5",
              loan.status === "overdue" ? "bg-overdue-soft" : "bg-next-soft",
            )}
          >
            {nextStep}
          </p>
        )}
      </div>
    </Card>
  );
}
