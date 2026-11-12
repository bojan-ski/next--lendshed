import "server-only";
import { db } from "@/db";
import { fromDbDate } from "@/data/db-dates";
import {
  borrowerNeedsActionLoanWhere,
  ownerNeedsActionLoanWhere,
} from "@/data/loan-scopes";
import { personName, toPhotoDTO } from "@/data/mappers";
import type { Prisma } from "@/generated/prisma/client";
import { effectiveStatus } from "@/lib/dates/effective-status";
import type { LoanCardDTO, MyLoansDTO } from "@/types/loan";

type Side = LoanCardDTO["side"];

const cardSelect = {
  id: true,
  status: true,
  startDate: true,
  endDate: true,
  changedAt: true,
  ownerSeenAt: true,
  borrowerSeenAt: true,
  item: {
    select: {
      id: true,
      title: true,
      photoUrl: true,
      photoWidth: true,
      photoHeight: true,
      owner: { select: { name: true } },
    },
  },
  borrower: { select: { name: true } },
} satisfies Prisma.LoanSelect;

export type MyLoanRow = Prisma.LoanGetPayload<{ select: typeof cardSelect }>;

function sideWhere(viewerId: string, side: Side): Prisma.LoanWhereInput {
  return side === "lending"
    ? { item: { ownerId: viewerId } }
    : { borrowerId: viewerId };
}

function needsYouOf(
  status: LoanCardDTO["status"],
  startDate: string,
  endDate: string,
  side: Side,
  today: string,
): LoanCardDTO["needsYou"] {
  switch (status) {
    case "requested":
      return side === "lending" ? "review_request" : null;
    case "approved":
      if (startDate > today) return null;
      return side === "lending" ? "hand_over" : "arrange_pickup";
    case "out":
      return side === "borrowing" && endDate === today ? "due_back" : null;
    case "overdue":
      return "overdue";
    default:
      return null;
  }
}

function groupOf(
  status: LoanCardDTO["status"],
  needsYou: LoanCardDTO["needsYou"],
): LoanCardDTO["group"] {
  if (needsYou !== null) return "needs_you";
  return status === "requested" || status === "approved" || status === "out"
    ? "active"
    : "past";
}

// Pure: the row side of the needs-action fragments in loan-scopes.ts.
export function toLoanCardDTO(
  row: MyLoanRow,
  side: Side,
  today: string,
): LoanCardDTO {
  const startDate = fromDbDate(row.startDate);
  const endDate = fromDbDate(row.endDate);
  const status = effectiveStatus(
    { status: row.status, startDate, endDate },
    today,
  );
  const needsYou = needsYouOf(status, startDate, endDate, side, today);
  const seenAt = side === "lending" ? row.ownerSeenAt : row.borrowerSeenAt;
  return {
    id: row.id,
    side,
    item: {
      id: row.item.id,
      title: row.item.title,
      photo: toPhotoDTO(row.item),
    },
    otherPartyName: personName(
      side === "lending" ? row.borrower : row.item.owner,
    ),
    startDate,
    endDate,
    status,
    group: groupOf(status, needsYou),
    needsYou,
    changed: seenAt === null || row.changedAt.getTime() > seenAt.getTime(),
  };
}

const byId = (a: LoanCardDTO, b: LoanCardDTO) =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

const byStartAsc = (a: LoanCardDTO, b: LoanCardDTO) =>
  a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : byId(a, b);

const byEndDesc = (a: LoanCardDTO, b: LoanCardDTO) =>
  a.endDate > b.endDate ? -1 : a.endDate < b.endDate ? 1 : byId(a, b);

// Every loan on the viewer's side, hidden and retired items included.
export async function getMyLoans(
  viewerId: string,
  side: Side,
  today: string,
): Promise<MyLoansDTO> {
  const rows = await db.loan.findMany({
    where: sideWhere(viewerId, side),
    select: cardSelect,
  });
  const loans: MyLoansDTO = { needs_you: [], active: [], past: [] };
  for (const row of rows) {
    const card = toLoanCardDTO(row, side, today);
    loans[card.group].push(card);
  }
  loans.needs_you.sort(byStartAsc);
  loans.active.sort(byStartAsc);
  loans.past.sort(byEndDesc);
  return loans;
}

// Equals the needs_you cards across both tabs; `side` counts one tab only.
export async function countNeedsAction(
  viewerId: string,
  today: string,
  side?: Side,
): Promise<number> {
  const lending: Prisma.LoanWhereInput = {
    AND: [sideWhere(viewerId, "lending"), ownerNeedsActionLoanWhere(today)],
  };
  const borrowing: Prisma.LoanWhereInput = {
    AND: [
      sideWhere(viewerId, "borrowing"),
      borrowerNeedsActionLoanWhere(today),
    ],
  };
  const where =
    side === "lending"
      ? lending
      : side === "borrowing"
        ? borrowing
        : { OR: [lending, borrowing] };
  return db.loan.count({ where });
}
