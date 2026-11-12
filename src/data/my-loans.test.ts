import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import { toDbDate } from "@/data/db-dates";
import { getOwnItems } from "@/data/items";
import {
  approveLoanRequest,
  getLoanForViewer,
  handOverLoan,
  insertLoanRequest,
  markLoanBack,
} from "@/data/loans";
import type { LoanStatus } from "@/generated/prisma/enums";
import { addDays, communityToday } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { people } from "@/strings/people";
import type { LoanCardDTO, MyLoansDTO } from "@/types/loan";
import {
  countNeedsAction,
  getMyLoans,
  type MyLoanRow,
  toLoanCardDTO,
} from "./my-loans";

vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const scope = createTestScope();

beforeAll(() => assertMigrated());
afterAll(() => scope.cleanup());

const TODAY = "2030-06-15";
const BEFORE = "2030-06-10";
const AFTER = "2030-06-20";
const STORED: LoanStatus[] = [
  "requested",
  "approved",
  "out",
  "returned",
  "declined",
  "cancelled",
  "expired",
  "lapsed",
];
// Every (start, end) from {before, at, after} today with start ≤ end.
const RANGES: [string, string][] = [
  [BEFORE, BEFORE],
  [BEFORE, TODAY],
  [BEFORE, AFTER],
  [TODAY, TODAY],
  [TODAY, AFTER],
  [AFTER, AFTER],
];
const OLD = new Date("2030-01-01T00:00:00Z");
const SIDES: LoanCardDTO["side"][] = ["lending", "borrowing"];

async function user(options: Parameters<typeof scope.createTestUser>[0] = {}) {
  return (await scope.createTestUser(options)).id;
}

const all = (loans: MyLoansDTO) => [
  ...loans.needs_you,
  ...loans.active,
  ...loans.past,
];

const ids = (loans: MyLoansDTO) =>
  all(loans)
    .map(({ id }) => id)
    .sort();

// An in-memory row: only status, dates and seen-at matter to the mapper's rules.
function row({
  status,
  startDate,
  endDate,
  changedAt = OLD,
  ownerSeenAt = OLD,
  borrowerSeenAt = OLD,
}: {
  status: LoanStatus;
  startDate: string;
  endDate: string;
  changedAt?: Date;
  ownerSeenAt?: Date | null;
  borrowerSeenAt?: Date | null;
}): MyLoanRow {
  return {
    id: "loan-1",
    status,
    startDate: toDbDate(startDate),
    endDate: toDbDate(endDate),
    changedAt,
    ownerSeenAt,
    borrowerSeenAt,
    item: {
      id: "item-1",
      title: "Ladder",
      photoUrl: null,
      photoWidth: null,
      photoHeight: null,
      owner: { name: "Olga M." },
    },
    borrower: { name: "Ana P." },
  };
}

// The spec's needsYou table, read row by row.
function tableNeedsYou(
  side: LoanCardDTO["side"],
  status: LoanCardDTO["status"],
  startDate: string,
  endDate: string,
): LoanCardDTO["needsYou"] {
  if (status === "requested")
    return side === "lending" ? "review_request" : null;
  if (status === "approved" && startDate <= TODAY) {
    return side === "lending" ? "hand_over" : "arrange_pickup";
  }
  if (status === "out" && endDate === TODAY && side === "borrowing") {
    return "due_back";
  }
  return status === "overdue" ? "overdue" : null;
}

describe("toLoanCardDTO — the needsYou and group table", () => {
  const cases = SIDES.flatMap((side) =>
    STORED.flatMap((status) =>
      RANGES.map(([startDate, endDate]) => ({
        side,
        status,
        startDate,
        endDate,
      })),
    ),
  );

  test.each(cases)(
    "$side $status $startDate–$endDate",
    ({ side, status, startDate, endDate }) => {
      const card = toLoanCardDTO(
        row({ status, startDate, endDate }),
        side,
        TODAY,
      );
      const effective = effectiveStatus({ status, startDate, endDate }, TODAY);
      const needsYou = tableNeedsYou(side, effective, startDate, endDate);

      expect(card.status).toBe(effective);
      expect(card.needsYou).toBe(needsYou);
      expect(card.group).toBe(
        needsYou !== null
          ? "needs_you"
          : ["requested", "approved", "out"].includes(effective)
            ? "active"
            : "past",
      );
    },
  );

  // A few rows spelled out, so the table above isn't only checked against itself.
  test.each([
    ["lending", "approved", TODAY, AFTER, "hand_over", "needs_you"],
    ["borrowing", "approved", BEFORE, AFTER, "arrange_pickup", "needs_you"],
    ["borrowing", "approved", AFTER, AFTER, null, "active"],
    ["borrowing", "out", BEFORE, TODAY, "due_back", "needs_you"],
    ["lending", "out", BEFORE, TODAY, null, "active"],
    ["lending", "out", BEFORE, BEFORE, "overdue", "needs_you"],
    ["borrowing", "out", BEFORE, BEFORE, "overdue", "needs_you"],
    ["borrowing", "requested", TODAY, AFTER, null, "active"],
    ["lending", "requested", BEFORE, AFTER, null, "past"],
    ["lending", "approved", BEFORE, BEFORE, null, "past"],
  ] as const)(
    "%s %s %s–%s → %s, %s",
    (side, status, startDate, endDate, needsYou, group) => {
      const card = toLoanCardDTO(
        row({ status, startDate, endDate }),
        side,
        TODAY,
      );
      expect([card.needsYou, card.group]).toEqual([needsYou, group]);
    },
  );
});

describe("toLoanCardDTO — the change dot", () => {
  const changedAt = new Date("2030-06-15T10:00:00.000Z");
  const earlier = new Date("2030-06-15T09:59:59.999Z");
  const later = new Date("2030-06-15T10:00:00.001Z");

  test.each([
    ["null", null, true],
    ["equal", changedAt, false],
    ["earlier", earlier, true],
    ["later", later, false],
  ] as const)(
    "the side's seen-at %s → changed %s",
    (_label, seenAt, changed) => {
      const base = {
        status: "approved" as const,
        startDate: TODAY,
        endDate: AFTER,
        changedAt,
      };
      // Lending reads ownerSeenAt only; Borrowing reads borrowerSeenAt only.
      expect(
        toLoanCardDTO(
          row({ ...base, ownerSeenAt: seenAt, borrowerSeenAt: OLD }),
          "lending",
          TODAY,
        ).changed,
      ).toBe(changed);
      expect(
        toLoanCardDTO(
          row({ ...base, borrowerSeenAt: seenAt, ownerSeenAt: OLD }),
          "borrowing",
          TODAY,
        ).changed,
      ).toBe(changed);
    },
  );
});

describe("getMyLoans — scope", () => {
  let ownerId: string;
  let borrowerId: string;
  let organizerId: string;
  const lent: string[] = [];
  const borrowed: string[] = [];
  let strangersLoan: string;
  let organizersLoan: string;

  beforeAll(async () => {
    let strangerA: string;
    let strangerB: string;
    [ownerId, borrowerId, organizerId, strangerA, strangerB] =
      await Promise.all([
        user({ name: "Olga M." }),
        user({ name: "Ana P." }),
        user({ name: "Ivo K.", role: "organizer" }),
        user(),
        user(),
      ]);
    // The owner's items in every state lend to the borrower.
    for (const status of ["listed", "hidden", "retired"] as const) {
      const { id: itemId } = await scope.createItem({ ownerId, status });
      const { id } = await scope.createLoan({
        itemId,
        borrowerId,
        status: "requested",
        startDate: AFTER,
        endDate: AFTER,
      });
      lent.push(id);
      borrowed.push(id);
    }
    // The borrower also borrows from a stranger.
    const { id: strangerItem } = await scope.createItem({ ownerId: strangerA });
    borrowed.push(
      (
        await scope.createLoan({
          itemId: strangerItem,
          borrowerId,
          status: "returned",
          startDate: BEFORE,
          endDate: BEFORE,
        })
      ).id,
    );
    // Two strangers' loan, and an organizer's own.
    strangersLoan = (
      await scope.createLoan({
        itemId: strangerItem,
        borrowerId: strangerB,
        status: "requested",
        startDate: AFTER,
        endDate: AFTER,
      })
    ).id;
    const { id: organizerItem } = await scope.createItem({
      ownerId: organizerId,
    });
    organizersLoan = (
      await scope.createLoan({
        itemId: organizerItem,
        borrowerId,
        status: "approved",
        startDate: AFTER,
        endDate: AFTER,
      })
    ).id;
    borrowed.push(organizersLoan);
  });

  test("Lending is every loan on the viewer's items, hidden and retired included", async () => {
    expect(ids(await getMyLoans(ownerId, "lending", TODAY))).toEqual(
      [...lent].sort(),
    );
  });

  test("Borrowing is every loan with the viewer as borrower", async () => {
    expect(ids(await getMyLoans(borrowerId, "borrowing", TODAY))).toEqual(
      [...borrowed].sort(),
    );
  });

  test("another member's loans appear in neither tab", async () => {
    for (const viewer of [ownerId, borrowerId]) {
      for (const side of SIDES) {
        expect(ids(await getMyLoans(viewer, side, TODAY))).not.toContain(
          strangersLoan,
        );
      }
    }
  });

  test("an organizer sees only their own loans", async () => {
    expect(ids(await getMyLoans(organizerId, "lending", TODAY))).toEqual([
      organizersLoan,
    ]);
    expect(ids(await getMyLoans(organizerId, "borrowing", TODAY))).toEqual([]);
  });
});

describe("getMyLoans — order, names, photos and the wire", () => {
  let ownerId: string;

  beforeAll(async () => {
    ownerId = await user({ name: "Olga M." });
  });

  async function lend(
    status: LoanStatus,
    startDate: string,
    endDate: string,
    options: {
      borrowerId?: string | null;
      itemStatus?: "listed" | "retired";
      photo?: boolean;
    } = {},
  ) {
    const { id: itemId } = await scope.createItem({
      ownerId,
      status: options.itemStatus ?? "listed",
      photo: options.photo ?? false,
    });
    const borrowerId =
      options.borrowerId === undefined ? await user() : options.borrowerId;
    return (
      await scope.createLoan({ itemId, borrowerId, status, startDate, endDate })
    ).id;
  }

  test("Needs you and Active by start ascending, Past by end descending, ties by id", async () => {
    const viewer = await user();
    ownerId = viewer;
    const [late, early, tieA, tieB] = await Promise.all([
      lend("requested", "2030-06-18", "2030-06-18"),
      lend("requested", "2030-06-16", "2030-06-16"),
      lend("requested", "2030-06-17", "2030-06-17"),
      lend("requested", "2030-06-17", "2030-06-17"),
    ]);
    const [laterStart, earlierStart] = await Promise.all([
      lend("approved", "2030-06-20", "2030-06-21"),
      lend("out", "2030-06-14", "2030-06-18"),
    ]);
    const [oldest, newerA, newerB] = await Promise.all([
      lend("returned", "2030-06-01", "2030-06-02"),
      lend("declined", "2030-06-11", "2030-06-12"),
      lend("cancelled", "2030-06-11", "2030-06-12"),
    ]);
    const loans = await getMyLoans(viewer, "lending", TODAY);
    const [tie1, tie2] = [tieA, tieB].sort();
    const [past1, past2] = [newerA, newerB].sort();

    expect(loans.needs_you.map(({ id }) => id)).toEqual([
      early,
      tie1,
      tie2,
      late,
    ]);
    expect(loans.active.map(({ id }) => id)).toEqual([
      earlierStart,
      laterStart,
    ]);
    expect(loans.past.map(({ id }) => id)).toEqual([past1, past2, oldest]);
  });

  test("a deleted borrower or owner reads Former member", async () => {
    const viewer = await user({ name: "Ana P." });
    ownerId = await user({ name: "Olga M." });
    await lend("returned", BEFORE, BEFORE, { borrowerId: null });
    const { id: orphanItem } = await scope.createItem({ ownerId: null });
    await scope.createLoan({
      itemId: orphanItem,
      borrowerId: viewer,
      status: "returned",
      startDate: BEFORE,
      endDate: BEFORE,
    });

    const lending = all(await getMyLoans(ownerId, "lending", TODAY));
    const borrowing = all(await getMyLoans(viewer, "borrowing", TODAY));
    expect(lending.map((card) => card.otherPartyName)).toEqual([
      people.formerMember,
    ]);
    expect(borrowing.map((card) => card.otherPartyName)).toEqual([
      people.formerMember,
    ]);
  });

  test("a photo maps to its DTO; a retired item has none", async () => {
    ownerId = await user();
    const withPhoto = await lend("requested", AFTER, AFTER, { photo: true });
    const retired = await lend("returned", BEFORE, BEFORE, {
      itemStatus: "retired",
    });
    const cards = all(await getMyLoans(ownerId, "lending", TODAY));
    const byId = new Map(cards.map((card) => [card.id, card]));

    expect(byId.get(withPhoto)!.item.photo).toEqual({
      url: expect.stringMatching(/^https:\/\/example\.test\//),
      width: 1200,
      height: 900,
    });
    expect(byId.get(retired)!.item.photo).toBeNull();
  });

  test("the serialised DTO carries no seen-at, changedAt, email, contact or party id", async () => {
    ownerId = await user({ contactDetails: "Owner phone" });
    const borrowerId = await user({ contactDetails: "Borrower phone" });
    await lend("approved", TODAY, AFTER, { borrowerId });
    const wire = JSON.stringify([
      await getMyLoans(ownerId, "lending", TODAY),
      await getMyLoans(borrowerId, "borrowing", TODAY),
    ]);
    for (const key of [
      "changedAt",
      "ownerSeenAt",
      "borrowerSeenAt",
      "email",
      "contactDetails",
      "ownerId",
      "borrowerId",
    ]) {
      expect(wire).not.toContain(`"${key}"`);
    }
    expect(wire).not.toContain("phone");
  });

  test("hand_over holds while another loan on the item is still out (OQ-34)", async () => {
    ownerId = await user();
    const { id: itemId } = await scope.createItem({
      ownerId,
      status: "listed",
    });
    const [holder, waiting] = await Promise.all([user(), user()]);
    const overdue = await scope.createLoan({
      itemId,
      borrowerId: holder,
      status: "out",
      startDate: "2030-06-05",
      endDate: BEFORE,
    });
    const approved = await scope.createLoan({
      itemId,
      borrowerId: waiting,
      status: "approved",
      startDate: TODAY,
      endDate: AFTER,
    });
    const cards = new Map(
      all(await getMyLoans(ownerId, "lending", TODAY)).map((card) => [
        card.id,
        card,
      ]),
    );
    expect(cards.get(approved.id)!.needsYou).toBe("hand_over");
    expect(cards.get(overdue.id)!.needsYou).toBe("overdue");
    expect(await countNeedsAction(ownerId, TODAY)).toBe(2);
  });
});

// The badge and the Needs you group are one rule: the count equals the
// needs_you cards across both tabs, read at 00:30 community time (the
// previous UTC day), whatever the server's zone.
describe("countNeedsAction agrees with the Needs you cards", () => {
  // Belgrade is UTC+2 in June: 22:30Z on the 14th is 00:30 on the 15th there.
  const NOW = new Date("2030-06-14T22:30:00Z");
  let viewerId: string;
  let otherId: string;

  beforeAll(async () => {
    [viewerId, otherId] = await Promise.all([user(), user()]);
    const cases = STORED.flatMap((status) =>
      RANGES.map(([startDate, endDate]) => ({ status, startDate, endDate })),
    );
    // The viewer lends every case to the other member, and borrows a few back.
    await Promise.all([
      ...cases.map(async (loan) => {
        const { id: itemId } = await scope.createItem({ ownerId: viewerId });
        await scope.createLoan({ itemId, borrowerId: otherId, ...loan });
      }),
      ...cases
        .filter(({ status }) => ["approved", "out"].includes(status))
        .map(async (loan) => {
          const { id: itemId } = await scope.createItem({ ownerId: otherId });
          await scope.createLoan({ itemId, borrowerId: viewerId, ...loan });
        }),
    ]);
  });

  describe.each(TEST_ZONES)("in %s", (zone) => {
    useProcessTimeZone(zone);
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test("today is the community date, not the UTC one", () => {
      expect(communityToday()).toBe(TODAY);
      expect(new Date().toISOString().slice(0, 10)).toBe("2030-06-14");
    });

    test.each([
      ["the viewer", () => viewerId],
      ["the other member", () => otherId],
    ])(
      "%s: the count = needs_you across both tabs, and per side",
      async (_label, who) => {
        const today = communityToday();
        const id = who();
        const [lending, borrowing] = await Promise.all([
          getMyLoans(id, "lending", today),
          getMyLoans(id, "borrowing", today),
        ]);
        const total = lending.needs_you.length + borrowing.needs_you.length;
        expect(total).toBeGreaterThan(0);
        expect(await countNeedsAction(id, today)).toBe(total);
        expect(await countNeedsAction(id, today, "lending")).toBe(
          lending.needs_you.length,
        );
        expect(await countNeedsAction(id, today, "borrowing")).toBe(
          borrowing.needs_you.length,
        );
      },
    );
  });
});

// Spec 16's journey, through the real 13–15 functions: each step's actor sees
// no dot, the other party sees one, and the counts follow the cards.
describe("the lending journey, as both parties and /my/items see it", () => {
  const T = TODAY;
  let ownerId: string;
  let borrowerId: string;
  let itemId: string;
  let loanId: string;

  beforeAll(async () => {
    [ownerId, borrowerId] = await Promise.all([
      user({ name: "Olga M.", contactDetails: "Owner phone" }),
      user({ name: "Ana P.", contactDetails: "Borrower phone" }),
    ]);
    itemId = (await scope.createItem({ ownerId, status: "listed" })).id;
  });

  async function seen(today: string) {
    const [lending, borrowing] = await Promise.all([
      getMyLoans(ownerId, "lending", today),
      getMyLoans(borrowerId, "borrowing", today),
    ]);
    const owner = all(lending).find((card) => card.id === loanId)!;
    const borrower = all(borrowing).find((card) => card.id === loanId)!;
    expect(await countNeedsAction(ownerId, today)).toBe(
      lending.needs_you.length,
    );
    expect(await countNeedsAction(borrowerId, today)).toBe(
      borrowing.needs_you.length,
    );
    const { rows } = await getOwnItems(ownerId, today);
    const now = rows.find((item) => item.id === itemId)!.now;
    return { owner, borrower, now };
  }

  test("1. request → the owner reviews it (dot), the borrower waits (no dot)", async () => {
    const outcome = await insertLoanRequest(
      borrowerId,
      { itemId, startDate: T, endDate: addDays(T, 2), message: null },
      T,
    );
    if (outcome.kind !== "created") throw new Error(outcome.kind);
    loanId = outcome.id;

    const { owner, borrower, now } = await seen(T);
    expect([owner.needsYou, owner.group, owner.changed]).toEqual([
      "review_request",
      "needs_you",
      true,
    ]);
    expect([borrower.needsYou, borrower.group, borrower.changed]).toEqual([
      null,
      "active",
      false,
    ]);
    expect(now).toEqual({ kind: "requested_by", personName: "Ana P." });
  });

  test("2. approve → hand over / arrange pickup on the start day; no loan kind on /my/items", async () => {
    expect(await approveLoanRequest(ownerId, loanId, T)).toBe("approved");

    const { owner, borrower, now } = await seen(T);
    expect([owner.needsYou, owner.changed]).toEqual(["hand_over", false]);
    expect([borrower.needsYou, borrower.changed]).toEqual([
      "arrange_pickup",
      true,
    ]);
    expect(now).toEqual({ kind: "idle", personName: null });
  });

  test("3. hand over → both Active; /my/items says it's with the borrower", async () => {
    expect(await handOverLoan(ownerId, loanId, T)).toBe("handedOver");

    const { owner, borrower, now } = await seen(T);
    expect([owner.group, owner.needsYou, owner.changed]).toEqual([
      "active",
      null,
      false,
    ]);
    expect([borrower.group, borrower.needsYou, borrower.changed]).toEqual([
      "active",
      null,
      true,
    ]);
    expect(now).toEqual({ kind: "with", personName: "Ana P." });
  });

  test("4. read on the end date → due back for the borrower; back today on /my/items", async () => {
    const { owner, borrower, now } = await seen(addDays(T, 2));
    expect(owner.needsYou).toBeNull();
    expect([borrower.needsYou, borrower.group]).toEqual([
      "due_back",
      "needs_you",
    ]);
    expect(now).toEqual({ kind: "back_today", personName: "Ana P." });
  });

  test("5. read the day after → overdue for both", async () => {
    const { owner, borrower, now } = await seen(addDays(T, 3));
    expect([owner.needsYou, borrower.needsYou]).toEqual(["overdue", "overdue"]);
    expect(now).toEqual({ kind: "overdue", personName: "Ana P." });
  });

  test("6. mark as back → both Past, the borrower's dot on; /my/items no longer names the loan", async () => {
    const day = addDays(T, 3);
    expect(
      await markLoanBack(
        ownerId,
        { id: loanId, returnedOn: day, asLent: "yes" },
        day,
      ),
    ).toBe("returned");

    const { owner, borrower, now } = await seen(day);
    expect([owner.group, owner.changed]).toEqual(["past", false]);
    expect([borrower.group, borrower.changed]).toEqual(["past", true]);
    expect(now).toEqual({ kind: "idle", personName: null });
  });

  test("7. opening the loan clears that viewer's dot", async () => {
    const day = addDays(T, 3);
    await getLoanForViewer({ id: borrowerId, role: "member" }, loanId, day);
    const { borrower } = await seen(day);
    expect(borrower.changed).toBe(false);
  });
});
