import "server-only";
import { fromDbDate } from "@/data/db-dates";
import { blockingLoanWhere, effectiveLoanWhere } from "@/data/loan-scopes";
import { personName } from "@/data/mappers";
import { containsText } from "@/data/text-search";
import { db } from "@/db";
import type {
  LoanSystemReason,
  MemberStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { communityToday } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { initialsOf } from "@/lib/text/initials";
import type {
  AdminMemberDetailDTO,
  AdminMemberOpenLoan,
  AdminMemberRowDTO,
  ReinstateOutcome,
  RoleChangeOutcome,
  SuspendOutcome,
} from "@/types/members";

// A waiting role change queues on the organizer locks inside its timeout.
const ROLE_TRANSACTION = { maxWait: 15_000, timeout: 30_000 };

const rowSelect = {
  id: true,
  name: true,
  role: true,
  status: true,
} satisfies Prisma.UserSelect;

const detailSelect = {
  ...rowSelect,
  area: true,
  createdAt: true,
} satisfies Prisma.UserSelect;

const openLoanSelect = {
  id: true,
  status: true,
  startDate: true,
  endDate: true,
  borrower: { select: { name: true } },
  item: {
    select: { title: true, ownerId: true, owner: { select: { name: true } } },
  },
} satisfies Prisma.LoanSelect;

type MemberRow = Prisma.UserGetPayload<{ select: typeof rowSelect }>;
type MemberDetailRow = Prisma.UserGetPayload<{ select: typeof detailSelect }>;
type OpenLoanRow = Prisma.LoanGetPayload<{ select: typeof openLoanSelect }>;

export async function getMemberStatus(
  userId: string,
): Promise<MemberStatus | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  return user?.status ?? null;
}

// Open = approved, out or overdue, as borrower or as the item's owner.
function openLoansOf(
  memberIds: string[],
  today: string,
): Prisma.LoanWhereInput {
  return {
    AND: [
      blockingLoanWhere(today),
      {
        OR: [
          { borrowerId: { in: memberIds } },
          { item: { ownerId: { in: memberIds } } },
        ],
      },
    ],
  };
}

export function toAdminMemberRowDTO(
  row: MemberRow,
  openLoanCount: number,
): AdminMemberRowDTO {
  return {
    id: row.id,
    displayName: row.name,
    initials: initialsOf(row.name),
    role: row.role,
    status: row.status,
    openLoanCount,
  };
}

export function toAdminMemberOpenLoan(
  row: OpenLoanRow,
  memberId: string,
  today: string,
): AdminMemberOpenLoan {
  const lent = row.item.ownerId === memberId;
  const endDate = fromDbDate(row.endDate);
  return {
    id: row.id,
    itemTitle: row.item.title,
    side: lent ? "lent" : "borrowed",
    otherPartyName: personName(lent ? row.borrower : row.item.owner),
    status: effectiveStatus(
      { status: row.status, startDate: fromDbDate(row.startDate), endDate },
      today,
    ),
    endDate,
  };
}

export function toAdminMemberDetailDTO(
  row: MemberDetailRow,
  viewerId: string,
  activeOrganizerCount: number,
  openLoans: AdminMemberOpenLoan[],
): AdminMemberDetailDTO {
  return {
    ...toAdminMemberRowDTO(row, openLoans.length),
    area: row.area,
    memberSince: communityToday(row.createdAt),
    openLoans,
    isSelf: row.id === viewerId,
    isLastActiveOrganizer:
      row.role === "organizer" &&
      row.status === "active" &&
      activeOrganizerCount === 1,
  };
}

// Names only: organizers never search or see emails. The open loans of every
// listed member come in one query, tallied here.
export async function getAdminMembers(
  q: string,
  today: string,
): Promise<AdminMemberRowDTO[]> {
  const rows = await db.user.findMany({
    where: q ? { name: containsText(q) } : {},
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: rowSelect,
  });
  if (rows.length === 0) return [];

  const loans = await db.loan.findMany({
    where: openLoansOf(
      rows.map(({ id }) => id),
      today,
    ),
    select: { borrowerId: true, item: { select: { ownerId: true } } },
  });
  const counts = new Map<string, number>();
  for (const loan of loans) {
    for (const id of [loan.borrowerId, loan.item.ownerId]) {
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return rows.map((row) => toAdminMemberRowDTO(row, counts.get(row.id) ?? 0));
}

export async function getAdminMemberDetail(
  viewerId: string,
  memberId: string,
  today: string,
): Promise<AdminMemberDetailDTO | null> {
  const [row, activeOrganizerCount, loans] = await Promise.all([
    db.user.findUnique({ where: { id: memberId }, select: detailSelect }),
    db.user.count({ where: { role: "organizer", status: "active" } }),
    db.loan.findMany({
      where: openLoansOf([memberId], today),
      orderBy: [{ endDate: "asc" }, { id: "asc" }],
      select: openLoanSelect,
    }),
  ]);
  return row
    ? toAdminMemberDetailDTO(
        row,
        viewerId,
        activeOrganizerCount,
        loans.map((loan) => toAdminMemberOpenLoan(loan, memberId, today)),
      )
    : null;
}

// Every organizer guard (demote here, suspend 18, delete 20) takes these locks
// first and in id order, so concurrent organizer actions serialise and the
// later one re-reads who is still an active organizer.
export async function lockActiveOrganizerIds(
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "user"
    WHERE role = 'organizer' AND status = 'active'
    ORDER BY id
    FOR UPDATE`;
  return rows.map(({ id }) => id);
}

export async function changeMemberRole(input: {
  actorId: string;
  memberId: string;
  to: Role;
}): Promise<RoleChangeOutcome> {
  return db.$transaction(async (tx): Promise<RoleChangeOutcome> => {
    const organizers = await lockActiveOrganizerIds(tx);
    if (!organizers.includes(input.actorId)) return "stale";

    if (input.to === "member") {
      if (!organizers.includes(input.memberId)) return "stale";
      // Unreachable while actor ≠ target; spec 20's self-deletion reaches it.
      if (organizers.length < 2) return "lastOrganizer";
    } else {
      const [target] = await tx.$queryRaw<
        { role: Role; status: MemberStatus }[]
      >`
        SELECT role, status FROM "user" WHERE id = ${input.memberId} FOR UPDATE`;
      if (target?.role !== "member" || target.status !== "active") {
        return "stale";
      }
    }

    await tx.user.update({
      where: { id: input.memberId },
      data: { role: input.to },
    });
    return "changed";
  }, ROLE_TRANSACTION);
}

// Every item a sweep can touch, locked in id order after the member's row:
// what they own (so no request lands on it after the sweep) and the items of
// their open borrower loans. The locked member row stops the set growing
// between the read and the lock.
async function lockMemberLoanItems(
  tx: Prisma.TransactionClient,
  memberId: string,
  today: string,
): Promise<void> {
  const items = await tx.item.findMany({
    where: {
      OR: [
        { ownerId: memberId },
        {
          loans: {
            some: {
              AND: [
                { borrowerId: memberId },
                {
                  OR: [
                    effectiveLoanWhere("requested", today),
                    effectiveLoanWhere("approved", today),
                  ],
                },
              ],
            },
          },
        },
      ],
    },
    select: { id: true },
  });
  if (items.length === 0) return;
  const ids = items.map(({ id }) => id);
  await tx.$queryRaw`
    SELECT id FROM item WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
}

// Effective requests and approvals only, on both sides. The member's own
// seen-at moves, so the other party sees the dot. Spec 20's deletion reuses it.
async function sweepMemberLoans(
  tx: Prisma.TransactionClient,
  memberId: string,
  today: string,
  now: Date,
  reason: { borrower: LoanSystemReason; owner: LoanSystemReason },
): Promise<void> {
  await tx.loan.updateMany({
    where: {
      AND: [{ borrowerId: memberId }, effectiveLoanWhere("requested", today)],
    },
    data: {
      status: "cancelled",
      endedBy: "system",
      systemReason: reason.borrower,
      changedAt: now,
      borrowerSeenAt: now,
    },
  });
  await tx.loan.updateMany({
    where: {
      AND: [{ borrowerId: memberId }, effectiveLoanWhere("approved", today)],
    },
    data: {
      status: "cancelled",
      endedBy: "system",
      systemReason: reason.borrower,
      changedAt: now,
      borrowerSeenAt: now,
    },
  });
  await tx.loan.updateMany({
    where: {
      AND: [
        { item: { ownerId: memberId } },
        effectiveLoanWhere("requested", today),
      ],
    },
    data: {
      status: "declined",
      endedBy: "system",
      systemReason: reason.owner,
      changedAt: now,
      ownerSeenAt: now,
    },
  });
  await tx.loan.updateMany({
    where: {
      AND: [
        { item: { ownerId: memberId } },
        effectiveLoanWhere("approved", today),
      ],
    },
    data: {
      status: "cancelled",
      endedBy: "system",
      systemReason: reason.owner,
      changedAt: now,
      ownerSeenAt: now,
    },
  });
}

// Lock order: organizers → the member's row → their items → loans
// (.claude/rules/data.md). Items keep their state; the visibility scope hides
// them, and out loans stay open for an organizer close.
export async function suspendMemberAccount(input: {
  actorId: string;
  memberId: string;
  today: string;
}): Promise<SuspendOutcome> {
  const now = new Date();
  return db.$transaction(async (tx): Promise<SuspendOutcome> => {
    const organizers = await lockActiveOrganizerIds(tx);
    if (!organizers.includes(input.actorId)) return "stale";
    const [member] = await tx.$queryRaw<{ role: Role; status: MemberStatus }[]>`
      SELECT role, status FROM "user" WHERE id = ${input.memberId} FOR UPDATE`;
    if (member?.status !== "active") return "stale";
    const organizer = member.role === "organizer";
    // Unreachable while actor ≠ target; kept for spec 20's symmetry.
    if (organizer && organizers.length < 2) return "lastOrganizer";

    await lockMemberLoanItems(tx, input.memberId, input.today);
    await sweepMemberLoans(tx, input.memberId, input.today, now, {
      borrower: "borrower_suspended",
      owner: "owner_suspended",
    });
    if (organizer) {
      await tx.invitation.updateMany({
        where: {
          createdById: input.memberId,
          usedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { revokedAt: now },
      });
    }
    await tx.user.update({
      where: { id: input.memberId },
      data: { status: "suspended" },
    });
    // No cookie cache: every device is signed out on its next request.
    await tx.session.deleteMany({ where: { userId: input.memberId } });
    return "suspended";
  }, ROLE_TRANSACTION);
}

// Access only: swept loans stay ended, revoked invitations stay revoked.
export async function reinstateMemberAccount(input: {
  actorId: string;
  memberId: string;
}): Promise<ReinstateOutcome> {
  return db.$transaction(async (tx): Promise<ReinstateOutcome> => {
    const organizers = await lockActiveOrganizerIds(tx);
    if (!organizers.includes(input.actorId)) return "stale";
    const [member] = await tx.$queryRaw<{ status: MemberStatus }[]>`
      SELECT status FROM "user" WHERE id = ${input.memberId} FOR UPDATE`;
    if (member?.status !== "suspended") return "stale";

    await tx.user.update({
      where: { id: input.memberId },
      data: { status: "active" },
    });
    return "reinstated";
  }, ROLE_TRANSACTION);
}
