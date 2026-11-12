import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import { fromDbDate } from "@/data/db-dates";
import { db } from "@/db";
import { addDays, loanLengthDays } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { SEED_ITEMS } from "./items";
import { SEED_PEOPLE } from "./people";
import {
  ensureReviewLoans,
  REVIEW_LOANS,
  reviewLoanMarker,
  type ReviewLoan,
  type ReviewLoanKind,
} from "./review-loans";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// Converges on scope users and items only; the real cast is untouched.
const scope = createTestScope();
beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

const TODAY = "2026-11-11";

const EXPECTED: Record<ReviewLoanKind, string> = {
  request: "requested",
  "approved-today": "approved",
  "approved-later": "approved",
  "out-later": "out",
  "out-today": "out",
  overdue: "overdue",
  returned: "returned",
};

// Every review loan on its own listed scope item; owners and borrowers rotate
// through three scope members with contact details.
async function copyOfTheCast(): Promise<{
  entries: ReviewLoan[];
  itemIds: string[];
}> {
  const people = [];
  for (const name of ["Ana", "Tom", "Sara"]) {
    people.push(
      await scope.createTestUser({ name, contactDetails: `Phone of ${name}` }),
    );
  }
  const entries: ReviewLoan[] = [];
  const itemIds: string[] = [];
  for (const [index, loan] of REVIEW_LOANS.entries()) {
    const owner = people[index % people.length];
    const borrower = people[(index + 1) % people.length];
    const { id } = await scope.createItem({
      ownerId: owner.id,
      title: loan.title,
      status: "listed",
      photo: true,
    });
    itemIds.push(id);
    entries.push({
      ...loan,
      ownerEmail: owner.email,
      borrowerEmail: borrower.email,
    });
  }
  return { entries, itemIds };
}

const marked = (itemIds: string[]) =>
  db.loan.findMany({
    where: {
      itemId: { in: itemIds },
      requestMessage: { startsWith: "review-loan:" },
    },
    orderBy: { requestMessage: "asc" },
    select: {
      id: true,
      itemId: true,
      borrowerId: true,
      requestMessage: true,
      status: true,
      startDate: true,
      endDate: true,
      returnedOn: true,
      returnedAsLent: true,
      endedBy: true,
      systemReason: true,
      closedById: true,
    },
  });

function expectIntended(
  rows: Awaited<ReturnType<typeof marked>>,
  entries: ReviewLoan[],
  today: string,
) {
  expect(rows).toHaveLength(entries.length);
  for (const entry of entries) {
    const row = rows.find(
      ({ requestMessage }) => requestMessage === reviewLoanMarker(entry.kind),
    )!;
    const loan = {
      status: row.status,
      startDate: fromDbDate(row.startDate),
      endDate: fromDbDate(row.endDate),
    };
    expect(loan.startDate).toBe(addDays(today, entry.startOffset));
    expect(loan.endDate).toBe(addDays(today, entry.endOffset));
    expect(effectiveStatus(loan, today)).toBe(EXPECTED[entry.kind]);
    const returned = entry.status === "returned";
    expect(row.returnedOn && fromDbDate(row.returnedOn)).toBe(
      returned ? loan.endDate : null,
    );
    expect(row.returnedAsLent).toBe(returned ? "yes" : null);
    expect([row.endedBy, row.systemReason, row.closedById]).toEqual([
      null,
      null,
      null,
    ]);
  }
}

describe("ensureReviewLoans", () => {
  test("creates one marked loan per kind, then converges without changing anything", async () => {
    const { entries, itemIds } = await copyOfTheCast();

    expect(await ensureReviewLoans(db, entries, TODAY)).toEqual({
      created: 7,
      updated: 0,
    });
    const first = await marked(itemIds);
    expectIntended(first, entries, TODAY);
    expect(new Set(first.map(({ itemId }) => itemId)).size).toBe(7);

    expect(await ensureReviewLoans(db, entries, TODAY)).toEqual({
      created: 0,
      updated: 7,
    });
    expect(await marked(itemIds)).toEqual(first);
  });

  test("a later today re-dates every marked row in place", async () => {
    const { entries, itemIds } = await copyOfTheCast();
    await ensureReviewLoans(db, entries, TODAY);
    const before = await marked(itemIds);

    const later = addDays(TODAY, 5);
    await ensureReviewLoans(db, entries, later);
    const after = await marked(itemIds);

    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    expectIntended(after, entries, later);
  });

  test("an unmarked loan on a designated item is left alone", async () => {
    const { entries, itemIds } = await copyOfTheCast();
    const borrower = await scope.createTestUser({ contactDetails: "Phone" });
    const { id } = await scope.createLoan({
      itemId: itemIds[0],
      borrowerId: borrower.id,
      status: "declined",
      startDate: addDays(TODAY, 1),
      endDate: addDays(TODAY, 2),
    });
    const unmarked = () => db.loan.findUniqueOrThrow({ where: { id } });
    const before = await unmarked();

    await ensureReviewLoans(db, entries, TODAY);
    await ensureReviewLoans(db, entries, addDays(TODAY, 3));

    expect(await unmarked()).toEqual(before);
  });

  // Once loans exist outside the seed (13), a re-dated row could collide with
  // one; the seed then stops with the item named, writing nothing for it (12a,
  // migration-auditor).
  test("refuses, naming the item, when an unmarked approved/out loan overlaps", async () => {
    const { entries, itemIds } = await copyOfTheCast();
    const index = entries.findIndex(({ kind }) => kind === "approved-later");
    const entry = entries[index];
    const borrower = await scope.createTestUser({ contactDetails: "Phone" });
    await scope.createLoan({
      itemId: itemIds[index],
      borrowerId: borrower.id,
      status: "approved",
      startDate: addDays(TODAY, entry.endOffset),
      endDate: addDays(TODAY, entry.endOffset + 1),
    });

    await expect(ensureReviewLoans(db, [entry], TODAY)).rejects.toThrow(
      new RegExp(`"${entry.title}".*overlap another`),
    );
    expect(await marked([itemIds[index]])).toEqual([]);
  });

  test("refuses, naming the item, when it is missing or not listed", async () => {
    const owner = await scope.createTestUser({ contactDetails: "Phone" });
    const borrower = await scope.createTestUser({ contactDetails: "Phone" });
    await scope.createItem({ ownerId: owner.id, title: "Hidden saw" });
    const entry = (title: string): ReviewLoan => ({
      ...REVIEW_LOANS[0],
      ownerEmail: owner.email,
      borrowerEmail: borrower.email,
      title,
    });

    await expect(
      ensureReviewLoans(db, [entry("Hidden saw")], TODAY),
    ).rejects.toThrow(/"Hidden saw".*not listed/);
    await expect(
      ensureReviewLoans(db, [entry("No such thing")], TODAY),
    ).rejects.toThrow(/"No such thing".*no such item/);
  });

  test("refuses a borrower without contact details", async () => {
    const owner = await scope.createTestUser({ contactDetails: "Phone" });
    const borrower = await scope.createTestUser();
    await scope.createItem({
      ownerId: owner.id,
      title: "Listed saw",
      status: "listed",
      photo: true,
    });

    await expect(
      ensureReviewLoans(
        db,
        [
          {
            ...REVIEW_LOANS[0],
            ownerEmail: owner.email,
            borrowerEmail: borrower.email,
            title: "Listed saw",
          },
        ],
        TODAY,
      ),
    ).rejects.toThrow(/"Listed saw".*borrower/);
  });
});

describe.each(TEST_ZONES)("dates read back in %s", (zone) => {
  useProcessTimeZone(zone);

  test("every stored date is the community date the seeder meant", async () => {
    const { entries, itemIds } = await copyOfTheCast();
    await ensureReviewLoans(db, entries, TODAY);
    expectIntended(await marked(itemIds), entries, TODAY);
  });
});

describe("REVIEW_LOANS on the real cast", () => {
  const people = new Map(SEED_PEOPLE.map((person) => [person.email, person]));
  const seedItem = (loan: ReviewLoan) =>
    SEED_ITEMS.find(
      ({ ownerEmail, title }) =>
        ownerEmail === loan.ownerEmail && title === loan.title,
    );

  test("one loan per kind, each on a different seed item", () => {
    expect(REVIEW_LOANS.map(({ kind }) => kind).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
    expect(new Set(REVIEW_LOANS.map(seedItem)).size).toBe(REVIEW_LOANS.length);
  });

  test.each(REVIEW_LOANS)(
    "$kind: active owner and borrower with contact details, within the item's max length",
    (loan) => {
      const owner = people.get(loan.ownerEmail);
      const borrower = people.get(loan.borrowerEmail);
      for (const member of [owner, borrower]) {
        expect(member?.status).toBe("active");
        expect(member?.contactDetails).not.toBeNull();
      }
      expect(loan.borrowerEmail).not.toBe(loan.ownerEmail);
      const item = seedItem(loan);
      expect(item).toBeDefined();
      expect(
        loanLengthDays(
          addDays(TODAY, loan.startOffset),
          addDays(TODAY, loan.endOffset),
        ),
      ).toBeLessThanOrEqual(item!.maxLoanDays);
    },
  );
});
