import "server-only";
import { db } from "@/db";
import type { MemberStatus, Prisma, Role } from "@/generated/prisma/client";
import { communityToday } from "@/lib/dates/dates";
import { initialsOf } from "@/lib/text/initials";
import type {
  AdminMemberDetailDTO,
  AdminMemberRowDTO,
  RoleChangeOutcome,
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

type MemberRow = Prisma.UserGetPayload<{ select: typeof rowSelect }>;
type MemberDetailRow = Prisma.UserGetPayload<{ select: typeof detailSelect }>;

export async function getMemberStatus(
  userId: string,
): Promise<MemberStatus | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  return user?.status ?? null;
}

// Spec 18 fills the open-loan count from real loans.
export function toAdminMemberRowDTO(row: MemberRow): AdminMemberRowDTO {
  return {
    id: row.id,
    displayName: row.name,
    initials: initialsOf(row.name),
    role: row.role,
    status: row.status,
    openLoanCount: 0,
  };
}

export function toAdminMemberDetailDTO(
  row: MemberDetailRow,
  viewerId: string,
  activeOrganizerCount: number,
): AdminMemberDetailDTO {
  return {
    ...toAdminMemberRowDTO(row),
    area: row.area,
    memberSince: communityToday(row.createdAt),
    openLoans: [],
    isSelf: row.id === viewerId,
    isLastActiveOrganizer:
      row.role === "organizer" &&
      row.status === "active" &&
      activeOrganizerCount === 1,
  };
}

// Names only: organizers never search or see emails.
export async function getAdminMembers(q: string): Promise<AdminMemberRowDTO[]> {
  const rows = await db.user.findMany({
    where: q ? { name: { contains: q, mode: "insensitive" } } : {},
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: rowSelect,
  });
  return rows.map(toAdminMemberRowDTO);
}

export async function getAdminMemberDetail(
  viewerId: string,
  memberId: string,
): Promise<AdminMemberDetailDTO | null> {
  const [row, activeOrganizerCount] = await Promise.all([
    db.user.findUnique({ where: { id: memberId }, select: detailSelect }),
    db.user.count({ where: { role: "organizer", status: "active" } }),
  ]);
  return row
    ? toAdminMemberDetailDTO(row, viewerId, activeOrganizerCount)
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
