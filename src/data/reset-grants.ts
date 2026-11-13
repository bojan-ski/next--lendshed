import "server-only";
import { lockActiveOrganizerIds } from "@/data/organizer-locks";
import { db } from "@/db";
import { setCredentialPassword } from "@/db/credentials";
import type { ResetOutcome } from "@/types/auth";
import type { ResetGrantOutcome } from "@/types/members";

const LIFETIME_MS = 60 * 60 * 1000;
// Hashing happens inside the reset transaction (.claude/rules/auth.md).
const RESET_TRANSACTION = { maxWait: 15_000, timeout: 30_000 };
// A create may queue behind a role change's organizer locks.
const LOCKING_TRANSACTION = { maxWait: 15_000, timeout: 30_000 };

// Organizer locks first, as every organizer guard: the grant's foreign key
// takes a key-share lock on its creator, so locking the member first could
// deadlock with a role change that holds the organizers and waits for the
// member. The member row lock then makes two concurrent creates leave one open
// grant: the second voids the first's grant after it commits.
export async function insertResetGrant(input: {
  userId: string;
  createdById: string;
  tokenHash: string;
}): Promise<ResetGrantOutcome> {
  const now = new Date();
  return db.$transaction(async (tx): Promise<ResetGrantOutcome> => {
    // Re-checked under the lock, as changeMemberRole does: the actor may have
    // been demoted since requireOrganizer().
    const organizers = await lockActiveOrganizerIds(tx);
    if (!organizers.includes(input.createdById)) return { kind: "actorGone" };
    const [member] = await tx.$queryRaw<{ name: string }[]>`
      SELECT name FROM "user" WHERE id = ${input.userId} FOR UPDATE`;
    if (!member) return { kind: "memberGone" };

    await tx.passwordResetGrant.updateMany({
      where: { userId: input.userId, usedAt: null },
      data: { usedAt: now },
    });
    await tx.passwordResetGrant.create({
      data: {
        ...input,
        createdAt: now,
        expiresAt: new Date(now.getTime() + LIFETIME_MS),
      },
    });
    return { kind: "created", displayName: member.name };
  }, LOCKING_TRANSACTION);
}

// The claim is a conditional update, so two resets on one link serialise on
// the row lock and the second matches nothing. A refused claim hashes nothing;
// any later failure rolls the claim back and leaves the link usable.
export async function resetPasswordThroughGrant(input: {
  tokenHash: string;
  password: string;
}): Promise<ResetOutcome> {
  const now = new Date();
  return db.$transaction(async (tx): Promise<ResetOutcome> => {
    const [grant] = await tx.passwordResetGrant.updateManyAndReturn({
      where: {
        tokenHash: input.tokenHash,
        usedAt: null,
        expiresAt: { gt: now },
      },
      data: { usedAt: now },
      select: { userId: true },
    });
    if (!grant) return { kind: "invalidToken" };

    await setCredentialPassword(tx, grant.userId, input.password);
    // No cookie cache: every device is signed out on its next request.
    await tx.session.deleteMany({ where: { userId: grant.userId } });
    return { kind: "reset", userId: grant.userId };
  }, RESET_TRANSACTION);
}
