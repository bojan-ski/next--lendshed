import type { createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import { addDays } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import type { EffectiveLoanStatus } from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

type Scope = ReturnType<typeof createTestScope>;

// The stored row behind each effective status, in days from today. `approved`
// starts today so the owner can hand it over; every other date is chosen so
// the status can't drift into a neighbour within the test.
const STORED: Record<
  EffectiveLoanStatus,
  { status: LoanStatus; from: number; to: number }
> = {
  requested: { status: "requested", from: 1, to: 2 },
  approved: { status: "approved", from: 0, to: 2 },
  out: { status: "out", from: -1, to: 1 },
  overdue: { status: "out", from: -3, to: -1 },
  returned: { status: "returned", from: -5, to: -3 },
  declined: { status: "declined", from: 1, to: 2 },
  cancelled: { status: "cancelled", from: 1, to: 2 },
  expired: { status: "requested", from: -2, to: -1 },
  lapsed: { status: "approved", from: -4, to: -1 },
};

// Before any test run, so a seen-at or changedAt a transition writes is new.
export const FIXTURE_INSTANT = new Date("2026-01-01T12:00:00.000Z");

export type LoanParties = {
  owner: ViewerDTO;
  borrower: ViewerDTO;
  member: ViewerDTO;
  organizer: ViewerDTO;
};

const viewerOf = (id: string, role: ViewerDTO["role"]): ViewerDTO => ({
  id,
  displayName: "Mira K.",
  initials: "MK",
  role,
});

// The owner and borrower have contact details; the member and the organizer
// are parties to nothing.
export async function createLoanParties(scope: Scope): Promise<LoanParties> {
  const [owner, borrower, member, organizer] = await Promise.all([
    scope.createTestUser({ name: "Olga M.", contactDetails: "Phone 1" }),
    scope.createTestUser({ name: "Bora P.", contactDetails: "Phone 2" }),
    scope.createTestUser({ name: "Ivo N." }),
    scope.createTestUser({ name: "Ruth K.", role: "organizer" }),
  ]);
  return {
    owner: viewerOf(owner.id, "member"),
    borrower: viewerOf(borrower.id, "member"),
    member: viewerOf(member.id, "member"),
    organizer: viewerOf(organizer.id, "organizer"),
  };
}

export type LoanFixtureOptions = {
  itemStatus?: ItemStatus;
  borrowerId?: string | null;
  // Overrides the status's own start; the end keeps its length.
  startOffset?: number;
};

// One loan in `status` on today, on its own listed item with a photo, with
// changedAt and both seen-ats at FIXTURE_INSTANT. Fails loudly when the
// stored row doesn't read back as the intended effective status.
export async function createLoanFixture(
  scope: Scope,
  parties: LoanParties,
  status: EffectiveLoanStatus,
  today: string,
  {
    itemStatus = "listed",
    borrowerId = parties.borrower.id,
    startOffset,
  }: LoanFixtureOptions = {},
): Promise<{ id: string; itemId: string }> {
  const stored = STORED[status];
  const from = startOffset ?? stored.from;
  const startDate = addDays(today, from);
  const endDate = addDays(today, from + stored.to - stored.from);
  const item = await scope.createItem({
    ownerId: parties.owner.id,
    status: itemStatus,
    photo: true,
  });
  const { id } = await scope.createLoan({
    itemId: item.id,
    borrowerId,
    status: stored.status,
    startDate,
    endDate,
    changedAt: FIXTURE_INSTANT,
    ownerSeenAt: FIXTURE_INSTANT,
    borrowerSeenAt: FIXTURE_INSTANT,
  });
  const read = effectiveStatus(
    { status: stored.status, startDate, endDate },
    today,
  );
  if (read !== status) {
    throw new Error(
      `Loan fixture for ${status} reads as ${read} on ${today} (${startDate} … ${endDate}).`,
    );
  }
  return { id, itemId: item.id };
}

// Every column, so "nothing written" means byte-identical.
export const loanRow = (id: string) =>
  db.loan.findUniqueOrThrow({ where: { id } });

// Every loan on the owner's items: a refusal leaves all of them as they were.
export const ownerLoans = (ownerId: string) =>
  db.loan.findMany({ where: { item: { ownerId } }, orderBy: { id: "asc" } });
