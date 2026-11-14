import "server-only";
import { lockActiveOrganizerIds } from "@/data/organizer-locks";
import { db } from "@/db";
import { createCredentialUser } from "@/db/credentials";
import { Prisma } from "@/generated/prisma/client";
import { people } from "@/strings/people";
import type { JoinOutcome } from "@/types/auth";
import type { InvitationRowDTO } from "@/types/invitation";

const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
// Hashing happens inside the join transaction (.claude/rules/auth.md).
const JOIN_TRANSACTION = { maxWait: 15_000, timeout: 30_000 };
// A create may queue behind a role change's organizer locks.
const LOCKING_TRANSACTION = { maxWait: 15_000, timeout: 30_000 };

const rowSelect = {
  id: true,
  note: true,
  expiresAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.InvitationSelect;

type InvitationRow = Prisma.InvitationGetPayload<{ select: typeof rowSelect }>;

// `now` is the app clock, the same one that wrote createdAt and expiresAt.
function openAt(now: Date) {
  return {
    usedAt: null,
    revokedAt: null,
    expiresAt: { gt: now },
  } satisfies Prisma.InvitationWhereInput;
}

export function toInvitationRowDTO(row: InvitationRow): InvitationRowDTO {
  return {
    id: row.id,
    note: row.note,
    expiresAt: row.expiresAt.toISOString(),
    createdByName: row.createdBy?.name ?? people.formerMember,
  };
}

export async function getOpenInvitations(): Promise<InvitationRowDTO[]> {
  const rows = await db.invitation.findMany({
    where: openAt(new Date()),
    orderBy: { createdAt: "desc" },
    select: rowSelect,
  });
  return rows.map(toInvitationRowDTO);
}

// Organizer locks first, as insertResetGrant: the invitation's foreign key
// takes a key-share lock on its creator, and a suspension of that creator
// either runs first (actorGone) or revokes this invitation after it commits.
export async function insertInvitation(input: {
  tokenHash: string;
  note: string | null;
  createdById: string;
}): Promise<"created" | "actorGone"> {
  const now = new Date();
  return db.$transaction(async (tx) => {
    const organizers = await lockActiveOrganizerIds(tx);
    if (!organizers.includes(input.createdById)) return "actorGone";
    await tx.invitation.create({
      data: {
        ...input,
        createdAt: now,
        expiresAt: new Date(now.getTime() + LIFETIME_MS),
      },
    });
    return "created";
  }, LOCKING_TRANSACTION);
}

export async function revokeOpenInvitation(
  id: string,
): Promise<"revoked" | "notOpen"> {
  const now = new Date();
  const { count } = await db.invitation.updateMany({
    where: { id, ...openAt(now) },
    data: { revokedAt: now },
  });
  return count === 1 ? "revoked" : "notOpen";
}

// The daily job: a used invitation stays as the join record; an unexpired one
// stays whether open or revoked.
export async function purgeExpiredInvitations(now: Date): Promise<number> {
  const { count } = await db.invitation.deleteMany({
    where: { usedAt: null, expiresAt: { lt: now } },
  });
  return count;
}

// The claim is a conditional update, so two joins on one link serialise on the
// row lock and the second matches nothing. A refused claim hashes nothing.
export async function joinThroughInvitation(input: {
  tokenHash: string;
  name: string;
  email: string;
  password: string;
}): Promise<JoinOutcome> {
  const now = new Date();
  try {
    return await db.$transaction(async (tx): Promise<JoinOutcome> => {
      const claim = await tx.invitation.updateMany({
        where: { tokenHash: input.tokenHash, ...openAt(now) },
        data: { usedAt: now },
      });
      if (claim.count === 0) return { kind: "invalidToken" };

      const { id } = await createCredentialUser(tx, {
        name: input.name,
        email: input.email,
        password: input.password,
        role: "member",
        status: "active",
      });
      await tx.invitation.update({
        where: { tokenHash: input.tokenHash },
        data: { usedById: id },
      });
      return { kind: "joined", userId: id };
    }, JOIN_TRANSACTION);
  } catch (error) {
    // Caught outside the transaction: the claim has already rolled back.
    if (isEmailTaken(error)) return { kind: "emailTaken" };
    throw error;
  }
}

// Under the pg adapter a P2002 names its constraint here, not in meta.target.
function isEmailTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code !== "P2002") return false;
  const cause = (error.meta?.driverAdapterError as { cause?: unknown })?.cause;
  const constraint = (cause as { constraint?: { index?: unknown } })
    ?.constraint;
  return constraint?.index === "user_email_key";
}
