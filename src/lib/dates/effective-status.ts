import type { EffectiveLoanStatus, LoanStatus } from "@/types/loan";

export type EffectiveStatusInput = {
  status: LoanStatus;
  startDate: string;
  endDate: string;
};

export function effectiveStatus(
  loan: EffectiveStatusInput,
  today: string,
): EffectiveLoanStatus {
  switch (loan.status) {
    case "requested":
      return loan.startDate < today ? "expired" : "requested";
    case "approved":
      return loan.endDate < today ? "lapsed" : "approved";
    case "out":
      return loan.endDate < today ? "overdue" : "out";
    case "expired":
    case "lapsed":
    case "returned":
    case "declined":
    case "cancelled":
      return loan.status;
    default: {
      const unreachable: never = loan.status;
      throw new RangeError(`Unknown loan status: ${String(unreachable)}`);
    }
  }
}
