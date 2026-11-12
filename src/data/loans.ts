import "server-only";
import { db } from "@/db";
import { fromDbDate, toDbDate } from "@/data/db-dates";
import { isDatesTaken } from "@/data/db-errors";
import {
  blockingLoanWhere,
  occupyingLoanWhere,
  openLoanWhere,
} from "@/data/loan-scopes";
import { personName, toPhotoDTO } from "@/data/mappers";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ItemStatus,
  LoanStatus,
  MemberStatus,
} from "@/generated/prisma/enums";
import { addDays, loanLengthDays } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { REQUEST_LIMITS } from "@/lib/loans/limits";
import type { MarkReturnedInput, RequestLoanInput } from "@/lib/schemas/loans";
import type {
  ApproveOutcome,
  CancelOutcome,
  CancelStage,
  DeclineOutcome,
  EffectiveLoanStatus,
  HandOverOutcome,
  InsertLoanRequestOutcome,
  LoanAction,
  LoanDetailDTO,
  LoanViewerRole,
  MarkBackOutcome,
} from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

// Contact details stay on a returned loan for this many days (brief §7.4).
const CONTACT_GRACE_DAYS = 7;

// Both ends count: a loan ending on another's first day overlaps it.
function overlapsWhere(start: string, end: string): Prisma.LoanWhereInput {
  return {
    startDate: { lte: toDbDate(end) },
    endDate: { gte: toDbDate(start) },
  };
}

// Another loan holding the item (OQ-34): stored `out`, whatever its dates.
function otherOccupyingWhere(
  itemId: string,
  loanId: string,
): Prisma.LoanWhereInput {
  return { AND: [{ itemId, id: { not: loanId } }, occupyingLoanWhere()] };
}

// The actor's own row FOR UPDATE first (updateOwnContactDetails takes it too,
// so a clear runs strictly before or after), then the item FOR SHARE (hide and
// retire hold it FOR UPDATE). One own user row only: no organizer lock
// (rules/data.md). The owner's row is read, never locked.
export async function insertLoanRequest(
  borrowerId: string,
  input: RequestLoanInput,
  today: string,
): Promise<InsertLoanRequestOutcome> {
  return db.$transaction(async (tx) => {
    const [actor] = await tx.$queryRaw<
      { status: MemberStatus; contactDetails: string | null }[]
    >`SELECT status, "contactDetails" FROM "user" WHERE id = ${borrowerId} FOR UPDATE`;
    if (actor?.status !== "active") return { kind: "stale" };

    const [item] = await tx.$queryRaw<
      { ownerId: string | null; status: ItemStatus; maxLoanDays: number }[]
    >`SELECT "ownerId", status, "maxLoanDays" FROM item WHERE id = ${input.itemId} FOR SHARE`;
    if (
      item?.status !== "listed" ||
      item.ownerId === null ||
      item.ownerId === borrowerId
    ) {
      return { kind: "stale" };
    }
    const owner = await tx.user.findUnique({
      where: { id: item.ownerId },
      select: { status: true },
    });
    if (owner?.status !== "active") return { kind: "stale" };

    if (actor.contactDetails === null) return { kind: "needsContactDetails" };

    const [onItem, overall] = await Promise.all([
      tx.loan.count({
        where: {
          AND: [{ borrowerId, itemId: input.itemId }, openLoanWhere(today)],
        },
      }),
      tx.loan.count({ where: { AND: [{ borrowerId }, openLoanWhere(today)] } }),
    ]);
    if (onItem >= REQUEST_LIMITS.perItem) return { kind: "itemLimit" };
    if (overall >= REQUEST_LIMITS.overall) return { kind: "overallLimit" };

    if (loanLengthDays(input.startDate, input.endDate) > item.maxLoanDays) {
      return { kind: "tooLong", maxLoanDays: item.maxLoanDays };
    }

    const taken = await tx.loan.count({
      where: {
        AND: [
          { itemId: input.itemId },
          blockingLoanWhere(today),
          overlapsWhere(input.startDate, input.endDate),
        ],
      },
      take: 1,
    });
    if (taken > 0) return { kind: "datesTaken" };

    const now = new Date();
    const loan = await tx.loan.create({
      data: {
        itemId: input.itemId,
        borrowerId,
        status: "requested",
        startDate: toDbDate(input.startDate),
        endDate: toDbDate(input.endDate),
        requestMessage: input.message,
        changedAt: now,
        borrowerSeenAt: now,
      },
      select: { id: true },
    });
    return { kind: "created", id: loan.id };
  });
}

const detailSelect = {
  id: true,
  status: true,
  startDate: true,
  endDate: true,
  borrowerId: true,
  requestMessage: true,
  statusReason: true,
  endedBy: true,
  systemReason: true,
  returnedOn: true,
  returnedAsLent: true,
  item: {
    select: {
      id: true,
      title: true,
      status: true,
      photoUrl: true,
      photoWidth: true,
      photoHeight: true,
      ownerId: true,
      owner: { select: { name: true, status: true, contactDetails: true } },
    },
  },
  borrower: { select: { name: true, contactDetails: true } },
  closedBy: { select: { name: true } },
} satisfies Prisma.LoanSelect;

type DetailRow = Prisma.LoanGetPayload<{ select: typeof detailSelect }>;

// A party role wins over organizer; anyone else can't tell the loan exists.
function roleOf(
  row: DetailRow,
  viewer: Pick<ViewerDTO, "id" | "role">,
): LoanViewerRole | null {
  if (row.item.ownerId === viewer.id) return "owner";
  if (row.borrowerId === viewer.id) return "borrower";
  return viewer.role === "organizer" ? "organizer" : null;
}

// The other party's details, only to a party, while the loan is live or for
// a week after its return. A suspension doesn't hide them.
function contactFor(
  role: LoanViewerRole,
  status: EffectiveLoanStatus,
  returnedOn: string | null,
  other: { name: string; contactDetails: string | null } | null,
  today: string,
): LoanDetailDTO["contact"] {
  if (role === "organizer" || !other || other.contactDetails === null) {
    return null;
  }
  const live =
    status === "approved" || status === "out" || status === "overdue";
  const recent =
    status === "returned" &&
    returnedOn !== null &&
    today <= addDays(returnedOn, CONTACT_GRACE_DAYS);
  return live || recent
    ? { name: other.name, details: other.contactDetails }
    : null;
}

type HandOverCheck = "ready" | "blocked" | "none";

function toLoanDetailDTO(
  row: DetailRow,
  role: LoanViewerRole,
  overlappingRequestCount: number,
  handOver: HandOverCheck,
  today: string,
): LoanDetailDTO {
  const startDate = fromDbDate(row.startDate);
  const endDate = fromDbDate(row.endDate);
  const returnedOn = fromDbDate(row.returnedOn);
  const status = effectiveStatus(
    { status: row.status, startDate, endDate },
    today,
  );
  const owner = row.item.owner;
  return {
    id: row.id,
    status,
    startDate,
    endDate,
    lengthDays: loanLengthDays(startDate, endDate),
    item: {
      id: row.item.id,
      title: row.item.title,
      photo: toPhotoDTO(row.item),
      status: row.item.status,
      viewable:
        role === "owner" ||
        (row.item.status === "listed" && owner?.status === "active"),
    },
    owner: { id: row.item.ownerId, displayName: personName(owner) },
    borrower: { id: row.borrowerId, displayName: personName(row.borrower) },
    viewerRole: role,
    requestMessage: row.requestMessage,
    statusReason: row.statusReason,
    endedBy: row.endedBy,
    systemReason: row.systemReason,
    returnedOn,
    returnedAsLent: row.returnedAsLent,
    closedByName: row.closedBy?.name ?? null,
    overlappingRequestCount,
    handOverBlocked: handOver === "blocked",
    contact: contactFor(
      role,
      status,
      returnedOn,
      role === "owner" ? row.borrower : owner,
      today,
    ),
    actions: actionsFor(row, role, status, handOver),
  };
}

// Exactly what the transitions below would accept from this viewer; a
// non-party organizer gets nothing here.
function actionsFor(
  row: DetailRow,
  role: LoanViewerRole,
  status: EffectiveLoanStatus,
  handOver: HandOverCheck,
): LoanAction[] {
  if (role === "organizer") return [];
  if (status === "approved") {
    return handOver === "ready" ? ["hand_over", "cancel"] : ["cancel"];
  }
  if (status === "out" || status === "overdue") {
    return role === "owner" ? ["mark_returned"] : [];
  }
  if (status !== "requested") return [];
  if (role === "borrower") return ["cancel"];
  const approvable = row.item.status === "listed" && row.borrowerId !== null;
  return approvable ? ["approve", "decline"] : ["decline"];
}

// Owner, borrower or any organizer; null otherwise, whatever the reason. A
// party's view records their own seen-at (never changedAt, so no one gets a
// change dot); an organizer who isn't a party writes nothing.
export async function getLoanForViewer(
  viewer: Pick<ViewerDTO, "id" | "role">,
  loanId: string,
  today: string,
): Promise<LoanDetailDTO | null> {
  const row = await db.loan.findUnique({
    where: { id: loanId },
    select: detailSelect,
  });
  if (!row) return null;
  const role = roleOf(row, viewer);
  if (!role) return null;

  const startDate = fromDbDate(row.startDate);
  const endDate = fromDbDate(row.endDate);
  const status = effectiveStatus(
    { status: row.status, startDate, endDate },
    today,
  );
  const countOverlaps = role === "owner" && status === "requested";
  // Only where handOverLoan would get as far as the OQ-34 check.
  const handOverDue =
    role === "owner" &&
    status === "approved" &&
    startDate <= today &&
    row.borrowerId !== null;
  const now = new Date();
  const [, overlapping, occupying] = await Promise.all([
    role === "organizer"
      ? null
      : db.loan.update({
          where: { id: row.id },
          data:
            role === "owner" ? { ownerSeenAt: now } : { borrowerSeenAt: now },
          select: { id: true },
        }),
    countOverlaps
      ? db.loan.count({
          where: {
            AND: [
              { itemId: row.item.id, id: { not: row.id } },
              openLoanWhere(today),
              overlapsWhere(startDate, endDate),
            ],
          },
        })
      : 0,
    handOverDue
      ? db.loan.count({
          where: otherOccupyingWhere(row.item.id, row.id),
          take: 1,
        })
      : 0,
  ]);
  const handOver: HandOverCheck = !handOverDue
    ? "none"
    : occupying > 0
      ? "blocked"
      : "ready";
  return toLoanDetailDTO(row, role, overlapping, handOver, today);
}

type LockedLoan = {
  id: string;
  itemId: string;
  itemOwnerId: string | null;
  itemStatus: ItemStatus;
  borrowerId: string | null;
  status: LoanStatus;
  startDate: string;
  endDate: string;
  returnedOn: string | null;
};

// Every loan transition locks the item, then the loan, and no `user` row
// (rules/data.md), so a decision, a new request (item FOR SHARE) and a hide
// or retire (item FOR UPDATE) on one item run one after another. Then it
// re-reads the loan under those locks; null for an unknown id.
async function lockLoanForTransition(
  tx: Prisma.TransactionClient,
  loanId: string,
): Promise<LockedLoan | null> {
  const target = await tx.loan.findUnique({
    where: { id: loanId },
    select: { itemId: true },
  });
  if (!target) return null;
  await tx.$queryRaw`SELECT id FROM item WHERE id = ${target.itemId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM loan WHERE id = ${loanId} FOR UPDATE`;
  const loan = await tx.loan.findUnique({
    where: { id: loanId },
    select: {
      id: true,
      itemId: true,
      borrowerId: true,
      status: true,
      startDate: true,
      endDate: true,
      returnedOn: true,
      item: { select: { ownerId: true, status: true } },
    },
  });
  if (!loan) return null;
  return {
    id: loan.id,
    itemId: loan.itemId,
    itemOwnerId: loan.item.ownerId,
    itemStatus: loan.item.status,
    borrowerId: loan.borrowerId,
    status: loan.status,
    startDate: fromDbDate(loan.startDate),
    endDate: fromDbDate(loan.endDate),
    returnedOn: fromDbDate(loan.returnedOn),
  };
}

function partyOf(
  loan: LockedLoan,
  actorId: string,
): "owner" | "borrower" | null {
  if (loan.itemOwnerId === actorId) return "owner";
  if (loan.borrowerId === actorId) return "borrower";
  return null;
}

// Only the actor's own seen-at moves, so only the other party gets a dot.
function seenAtFor(party: "owner" | "borrower", now: Date) {
  return party === "owner" ? { ownerSeenAt: now } : { borrowerSeenAt: now };
}

// No overlap query: approvals on one item serialise on the item lock, and the
// winner's sweep turns the loser stale. loan_no_overlap is the backstop; its
// 23P01 aborts the transaction, so it is mapped outside it.
export async function approveLoanRequest(
  ownerId: string,
  loanId: string,
  today: string,
): Promise<ApproveOutcome> {
  try {
    return await db.$transaction(async (tx) => {
      const loan = await lockLoanForTransition(tx, loanId);
      if (
        !loan ||
        loan.itemOwnerId !== ownerId ||
        loan.itemStatus !== "listed" ||
        loan.borrowerId === null ||
        effectiveStatus(loan, today) !== "requested"
      ) {
        return "stale";
      }
      const now = new Date();
      await tx.loan.update({
        where: { id: loan.id },
        data: { status: "approved", changedAt: now, ownerSeenAt: now },
        select: { id: true },
      });
      await tx.loan.updateMany({
        where: {
          AND: [
            { itemId: loan.itemId, id: { not: loan.id } },
            openLoanWhere(today),
            overlapsWhere(loan.startDate, loan.endDate),
          ],
        },
        data: {
          status: "declined",
          endedBy: "system",
          systemReason: "dates_taken",
          changedAt: now,
          ownerSeenAt: now,
        },
      });
      return "approved";
    });
  } catch (error) {
    if (isDatesTaken(error)) return "datesTaken";
    throw error;
  }
}

export async function declineLoanRequest(
  ownerId: string,
  loanId: string,
  reason: string | null,
  today: string,
): Promise<DeclineOutcome> {
  return db.$transaction(async (tx) => {
    const loan = await lockLoanForTransition(tx, loanId);
    if (
      !loan ||
      loan.itemOwnerId !== ownerId ||
      effectiveStatus(loan, today) !== "requested"
    ) {
      return "stale";
    }
    const now = new Date();
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        status: "declined",
        endedBy: "owner",
        systemReason: null,
        statusReason: reason,
        changedAt: now,
        ownerSeenAt: now,
      },
      select: { id: true },
    });
    return "declined";
  });
}

// The borrower withdraws a request or an approved loan; the owner calls off
// an approved one. Never once it is out. `stage` is what the screen offered:
// a "Cancel request" that finds the loan approved since is stale, not a
// second change.
export async function cancelLoanByParty(
  actorId: string,
  loanId: string,
  stage: CancelStage,
  reason: string | null,
  today: string,
): Promise<CancelOutcome> {
  return db.$transaction(async (tx) => {
    const loan = await lockLoanForTransition(tx, loanId);
    const party = loan && partyOf(loan, actorId);
    if (!loan || !party) return "stale";
    const status = effectiveStatus(loan, today);
    const allowed =
      stage === "loan"
        ? status === "approved"
        : status === "requested" && party === "borrower";
    if (!allowed) return "stale";
    const now = new Date();
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        status: "cancelled",
        endedBy: party,
        systemReason: null,
        statusReason: reason,
        changedAt: now,
        ...seenAtFor(party, now),
      },
      select: { id: true },
    });
    return "cancelled";
  });
}

// From its start date until it lapses. An overdue loan's dates lie in the
// past, so loan_no_overlap can't see it: the OQ-34 check runs here, under the
// item lock, and a return of that loan waits on the same lock. Approved to
// out keeps the row in the constraint's set with the same range, so no 23P01.
export async function handOverLoan(
  ownerId: string,
  loanId: string,
  today: string,
): Promise<HandOverOutcome> {
  return db.$transaction(async (tx) => {
    const loan = await lockLoanForTransition(tx, loanId);
    if (
      !loan ||
      loan.itemOwnerId !== ownerId ||
      loan.borrowerId === null ||
      effectiveStatus(loan, today) !== "approved" ||
      loan.startDate > today
    ) {
      return "stale";
    }
    const occupying = await tx.loan.count({
      where: otherOccupyingWhere(loan.itemId, loan.id),
      take: 1,
    });
    if (occupying > 0) return "stillOut";
    const now = new Date();
    await tx.loan.update({
      where: { id: loan.id },
      data: { status: "out", changedAt: now, ownerSeenAt: now },
      select: { id: true },
    });
    return "handedOver";
  });
}

// `returnedOn ≤ today` is the action's check; the start date is the locked
// row's. A return is not an ending decision, so `endedBy` stays null.
export async function markLoanBack(
  ownerId: string,
  input: MarkReturnedInput,
  today: string,
): Promise<MarkBackOutcome> {
  return db.$transaction(async (tx) => {
    const loan = await lockLoanForTransition(tx, input.id);
    const status = loan && effectiveStatus(loan, today);
    if (
      !loan ||
      loan.itemOwnerId !== ownerId ||
      (status !== "out" && status !== "overdue")
    ) {
      return "stale";
    }
    if (input.returnedOn < loan.startDate) return "beforeStart";
    const now = new Date();
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        status: "returned",
        returnedOn: toDbDate(input.returnedOn),
        returnedAsLent: input.asLent,
        changedAt: now,
        ownerSeenAt: now,
      },
      select: { id: true },
    });
    return "returned";
  });
}
