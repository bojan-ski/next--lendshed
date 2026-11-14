import { randomBytes } from "node:crypto";
import {
  createLoanFixture,
  type LoanParties,
} from "@/__tests__/support/loan-fixtures";
import type { createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import type { EffectiveLoanStatus } from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

type Scope = ReturnType<typeof createTestScope>;

export type MemberSide = "borrower" | "owner";

export const viewerOf = (
  id: string,
  role: ViewerDTO["role"] = "member",
): ViewerDTO => ({ id, displayName: "Mira K.", initials: "MK", role });

// A live session row, as the auth library writes one (no sign-in, no rate limit).
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(16).toString("hex");
  await db.session.create({
    data: {
      id: token,
      token,
      userId,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    },
  });
}

// The photo key the scope generated for an item, tracked so its queue row
// and (absent) file go with the cleanup.
export async function trackItemPhoto(
  scope: Scope,
  itemId: string,
): Promise<string | null> {
  const { photoKey } = await db.item.findUniqueOrThrow({
    where: { id: itemId },
    select: { photoKey: true },
  });
  if (photoKey) scope.trackPhotoKey(photoKey);
  return photoKey;
}

// One subject with one loan in `status` on the chosen side: the subject
// borrows the counterpart's item, or the counterpart borrows the subject's.
// The subject has a live session so a revocation is observable.
export async function createSideCell(
  scope: Scope,
  input: {
    side: MemberSide;
    status: EffectiveLoanStatus;
    today: string;
    counterpart: ViewerDTO;
    subjectStatus?: "active" | "suspended";
  },
): Promise<{ subject: ViewerDTO; loanId: string; itemId: string }> {
  const created = await scope.createTestUser({
    name: "Sam S.",
    contactDetails: "Phone 3",
    status: input.subjectStatus ?? "active",
  });
  const subject = viewerOf(created.id);
  const parties: LoanParties = {
    owner: input.side === "owner" ? subject : input.counterpart,
    borrower: input.side === "borrower" ? subject : input.counterpart,
    member: input.counterpart,
    organizer: input.counterpart,
  };
  const { id, itemId } = await createLoanFixture(
    scope,
    parties,
    input.status,
    input.today,
  );
  await trackItemPhoto(scope, itemId);
  if ((input.subjectStatus ?? "active") === "active") {
    await createSession(subject.id);
  }
  return { subject, loanId: id, itemId };
}

// Every row a member's account touches, each list in id order: a refused
// workflow leaves all of it byte-identical.
export async function memberFootprint(memberId: string) {
  const items = await db.item.findMany({
    where: { OR: [{ ownerId: memberId }, { retiredById: memberId }] },
    orderBy: { id: "asc" },
  });
  const keys = items.flatMap(({ photoKey }) => (photoKey ? [photoKey] : []));
  const [user, loans, invitations, sessions, grants, queue, uploads] =
    await Promise.all([
      db.user.findUnique({ where: { id: memberId } }),
      db.loan.findMany({
        where: {
          OR: [
            { borrowerId: memberId },
            { closedById: memberId },
            { item: { ownerId: memberId } },
          ],
        },
        orderBy: { id: "asc" },
      }),
      db.invitation.findMany({
        where: { OR: [{ createdById: memberId }, { usedById: memberId }] },
        orderBy: { id: "asc" },
      }),
      db.session.findMany({
        where: { userId: memberId },
        orderBy: { id: "asc" },
      }),
      db.passwordResetGrant.findMany({
        where: { OR: [{ userId: memberId }, { createdById: memberId }] },
        orderBy: { id: "asc" },
      }),
      db.pendingBlobDeletion.findMany({
        where: { storageKey: { in: keys } },
        orderBy: { id: "asc" },
      }),
      db.uploadLog.findMany({
        where: { userId: memberId },
        orderBy: { id: "asc" },
      }),
    ]);
  return { user, loans, items, invitations, sessions, grants, queue, uploads };
}

// Runs `make` over `inputs` a few at a time: the shared Neon database
// refuses a wide burst of connections.
export async function inBatches<T, R>(
  inputs: readonly T[],
  make: (input: T) => Promise<R>,
  size = 6,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < inputs.length; i += size) {
    out.push(...(await Promise.all(inputs.slice(i, i + size).map(make))));
  }
  return out;
}
