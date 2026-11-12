import "server-only";
import { toDbDate } from "@/data/db-dates";
import type { Prisma } from "@/generated/prisma/client";
import type { EffectiveLoanStatus } from "@/types/loan";

// The query side of effectiveStatus (src/lib/dates/effective-status.ts): a row
// matches effectiveLoanWhere(k, today) exactly when effectiveStatus(row, today)
// is k. Nothing else in src/data/ filters a loan by its stored status.
export function effectiveLoanWhere(
  status: EffectiveLoanStatus,
  today: string,
): Prisma.LoanWhereInput {
  const day = toDbDate(today);
  switch (status) {
    case "requested":
      return { status: "requested", startDate: { gte: day } };
    case "expired":
      return {
        OR: [
          { status: "expired" },
          { status: "requested", startDate: { lt: day } },
        ],
      };
    case "approved":
      return { status: "approved", endDate: { gte: day } };
    case "lapsed":
      return {
        OR: [
          { status: "lapsed" },
          { status: "approved", endDate: { lt: day } },
        ],
      };
    case "out":
      return { status: "out", endDate: { gte: day } };
    case "overdue":
      return { status: "out", endDate: { lt: day } };
    case "returned":
    case "declined":
    case "cancelled":
      return { status };
    default: {
      const unreachable: never = status;
      throw new RangeError(`Unknown loan status: ${String(unreachable)}`);
    }
  }
}

export function openLoanWhere(today: string): Prisma.LoanWhereInput {
  return effectiveLoanWhere("requested", today);
}

// Blocks an owner's retire; also the "Already booked" rows (overdue = still out).
export function blockingLoanWhere(today: string): Prisma.LoanWhereInput {
  return {
    OR: [
      effectiveLoanWhere("approved", today),
      effectiveLoanWhere("out", today),
      effectiveLoanWhere("overdue", today),
    ],
  };
}

// An out loan holds its item until it is marked back, whatever its end date (OQ-34).
export function occupyingLoanWhere(): Prisma.LoanWhereInput {
  return { status: "out" };
}

export function coversTodayLoanWhere(today: string): Prisma.LoanWhereInput {
  const day = toDbDate(today);
  return {
    AND: [
      {
        OR: [
          effectiveLoanWhere("approved", today),
          effectiveLoanWhere("out", today),
        ],
      },
      { startDate: { lte: day } },
      { endDate: { gte: day } },
    ],
  };
}

// A listed item is free today when it has no such loan (OQ-34: an overdue out
// loan still holds it).
export function notFreeTodayLoanWhere(today: string): Prisma.LoanWhereInput {
  return { OR: [coversTodayLoanWhere(today), occupyingLoanWhere()] };
}

function startedApprovedLoanWhere(today: string): Prisma.LoanWhereInput {
  return {
    AND: [
      effectiveLoanWhere("approved", today),
      { startDate: { lte: toDbDate(today) } },
    ],
  };
}

// The query side of toLoanCardDTO's needsYou (src/data/my-loans.ts): a row
// matches a side's fragment exactly when its card on that side needs you.
// hand_over counts even while another loan still holds the item (OQ-34).
export function ownerNeedsActionLoanWhere(
  today: string,
): Prisma.LoanWhereInput {
  return {
    OR: [
      effectiveLoanWhere("requested", today),
      startedApprovedLoanWhere(today),
      effectiveLoanWhere("overdue", today),
    ],
  };
}

export function borrowerNeedsActionLoanWhere(
  today: string,
): Prisma.LoanWhereInput {
  return {
    OR: [
      startedApprovedLoanWhere(today),
      {
        AND: [effectiveLoanWhere("out", today), { endDate: toDbDate(today) }],
      },
      effectiveLoanWhere("overdue", today),
    ],
  };
}
