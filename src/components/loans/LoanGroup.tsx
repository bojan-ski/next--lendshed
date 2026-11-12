import LoanCard from "@/components/loans/LoanCard";
import { formatDate, formatDateRange } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { loanCard } from "@/strings/loanCard";
import type { LoanCardDTO } from "@/types/loan";

function nextStepOf(loan: LoanCardDTO, today: string): string | null {
  if (loan.needsYou === null) return null;
  const template =
    loan.needsYou === "overdue"
      ? loanCard.overdue[loan.side]
      : loanCard.nextStep[loan.needsYou];
  return t(template, {
    name: loan.otherPartyName,
    date: formatDate(loan.endDate, today),
  });
}

export default function LoanGroup({
  heading,
  loans,
  today,
}: {
  heading: string;
  loans: LoanCardDTO[];
  today: string;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xl font-bold">{heading}</h2>
      <ul className="flex flex-col gap-3">
        {loans.map((loan) => (
          <li key={loan.id}>
            <LoanCard
              loan={loan}
              dateRange={formatDateRange(loan.startDate, loan.endDate, today)}
              nextStep={nextStepOf(loan, today)}
              headingLevel="h3"
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
