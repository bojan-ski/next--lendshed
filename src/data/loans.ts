import "server-only";
import { db } from "@/db";
import { fromDbDate, toDbDate } from "@/data/db-dates";
import { blockingLoanWhere, openLoanWhere } from "@/data/loan-scopes";
import { personName, toPhotoDTO } from "@/data/mappers";
import type { Prisma } from "@/generated/prisma/client";
import type { ItemStatus, MemberStatus } from "@/generated/prisma/enums";
import { addDays, loanLengthDays } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { REQUEST_LIMITS } from "@/lib/loans/limits";
import type { RequestLoanInput } from "@/lib/schemas/loans";
import type {
  EffectiveLoanStatus,
  InsertLoanRequestOutcome,
  LoanDetailDTO,
  LoanViewerRole,
} from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

// Contact details stay on a returned loan for this many days (brief §7.4).
const CONTACT_GRACE_DAYS = 7;

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
          { startDate: { lte: toDbDate(input.endDate) } },
          { endDate: { gte: toDbDate(input.startDate) } },
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

function toLoanDetailDTO(
  row: DetailRow,
  role: LoanViewerRole,
  overlappingRequestCount: number,
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
    contact: contactFor(
      role,
      status,
      returnedOn,
      role === "owner" ? row.borrower : owner,
      today,
    ),
    actions: [],
  };
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
  const countOverlaps =
    role === "owner" &&
    effectiveStatus({ status: row.status, startDate, endDate }, today) ===
      "requested";
  const now = new Date();
  const [, overlapping] = await Promise.all([
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
              { startDate: { lte: toDbDate(endDate) } },
              { endDate: { gte: toDbDate(startDate) } },
            ],
          },
        })
      : 0,
  ]);
  return toLoanDetailDTO(row, role, overlapping, today);
}
