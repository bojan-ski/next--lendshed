import { randomUUID } from "node:crypto";
import { holdRow } from "@/__tests__/support/hold-row";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { hideOwnItem } from "@/data/items";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import type { LoanAction } from "@/types/loan";
import {
  approveLoanRequest,
  cancelLoanByParty,
  declineLoanRequest,
  getLoanForViewer,
  insertLoanRequest,
} from "./loans";

vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const TODAY = "2030-06-15";
const YESTERDAY = "2030-06-14";
// Every fixture starts "seen and changed" long ago, so a write is visible.
const OLD = new Date("2030-01-01T00:00:00Z");
let ownerId: string;
let borrowerId: string;
let otherBorrowerId: string;
let organizerId: string;
let strangerId: string;

beforeAll(async () => {
  await assertMigrated();
  [ownerId, borrowerId, otherBorrowerId, organizerId, strangerId] =
    await Promise.all([
      user({ name: "Olga M.", contactDetails: "Owner phone" }),
      user({ name: "Ana P.", contactDetails: "Borrower phone" }),
      user({ name: "Ruth B.", contactDetails: "Ruth phone" }),
      user({ name: "Ivo K.", role: "organizer" }),
      user({ name: "Sara L." }),
    ]);
});
afterAll(() => scope.cleanup());

async function user(options: Parameters<typeof scope.createTestUser>[0]) {
  return (await scope.createTestUser(options)).id;
}

async function item(
  owner: string | null = ownerId,
  status: ItemStatus = "listed",
) {
  return (await scope.createItem({ ownerId: owner, status })).id;
}

type LoanFixture = {
  itemId?: string;
  status?: LoanStatus;
  startDate?: string;
  endDate?: string;
  borrower?: string | null;
  owner?: string | null;
  itemStatus?: ItemStatus;
};

async function loan({
  itemId,
  status = "requested",
  startDate = "2030-06-20",
  endDate = "2030-06-22",
  borrower = borrowerId,
  owner = ownerId,
  itemStatus = "listed",
}: LoanFixture = {}) {
  const onItem = itemId ?? (await item(owner, itemStatus));
  const { id } = await scope.createLoan({
    itemId: onItem,
    borrowerId: borrower,
    status,
    startDate,
    endDate,
    changedAt: OLD,
    ownerSeenAt: OLD,
    borrowerSeenAt: OLD,
  });
  return { id, itemId: onItem };
}

const row = (id: string) => db.loan.findUniqueOrThrow({ where: { id } });

async function expectUnchanged(id: string, status: LoanStatus) {
  const after = await row(id);
  expect(after.status).toBe(status);
  expect(after.changedAt).toEqual(OLD);
  expect(after.ownerSeenAt).toEqual(OLD);
  expect(after.borrowerSeenAt).toEqual(OLD);
}

function expectRecent(value: Date | null, since: number) {
  expect(value).not.toBeNull();
  expect(value!.getTime()).toBeGreaterThanOrEqual(since - 1000);
}

describe("approveLoanRequest", () => {
  test("the owner on a request → approved; only the owner's seen-at moves", async () => {
    const { id } = await loan();
    const before = Date.now();

    expect(await approveLoanRequest(ownerId, id, TODAY)).toBe("approved");

    const after = await row(id);
    expect(after.status).toBe("approved");
    expectRecent(after.changedAt, before);
    expectRecent(after.ownerSeenAt, before);
    expect(after.borrowerSeenAt).toEqual(OLD);
    expect(after).toMatchObject({
      endedBy: null,
      systemReason: null,
      statusReason: null,
    });
  });

  test("a request starting today is approved; one that started yesterday is stale", async () => {
    const today = await loan({ startDate: TODAY, endDate: TODAY });
    const expired = await loan({ startDate: YESTERDAY, endDate: TODAY });

    expect(await approveLoanRequest(ownerId, today.id, TODAY)).toBe("approved");
    expect(await approveLoanRequest(ownerId, expired.id, TODAY)).toBe("stale");
    await expectUnchanged(expired.id, "requested");
  });

  test("an organizer who owns the item approves as its owner", async () => {
    const { id } = await loan({ owner: organizerId });
    expect(await approveLoanRequest(organizerId, id, TODAY)).toBe("approved");
  });

  test.each<[string, () => string, LoanFixture]>([
    ["the borrower", () => borrowerId, {}],
    ["a non-party member", () => strangerId, {}],
    ["a non-party organizer", () => organizerId, {}],
    ["the owner, an approved loan", () => ownerId, { status: "approved" }],
    ["the owner, a declined loan", () => ownerId, { status: "declined" }],
    ["the owner, a cancelled loan", () => ownerId, { status: "cancelled" }],
    ["the owner, a hidden item", () => ownerId, { itemStatus: "hidden" }],
    ["the owner, a gone borrower", () => ownerId, { borrower: null }],
  ])("%s → stale, nothing written", async (_, actor, fixture) => {
    const { id } = await loan(fixture);
    expect(await approveLoanRequest(actor(), id, TODAY)).toBe("stale");
    await expectUnchanged(id, fixture.status ?? "requested");
  });

  test("an unknown or malformed id → stale", async () => {
    expect(await approveLoanRequest(ownerId, randomUUID(), TODAY)).toBe(
      "stale",
    );
    expect(await approveLoanRequest(ownerId, "not-an-id", TODAY)).toBe("stale");
  });
});

describe("approveLoanRequest — the sweep", () => {
  test("overlapping open requests are declined dates_taken; the rest stay as stored", async () => {
    const itemId = await item();
    const target = await loan({
      itemId,
      startDate: "2030-06-20",
      endDate: "2030-06-22",
    });
    // Ends on the target's first day: one shared day.
    const edge = await loan({
      itemId,
      borrower: otherBorrowerId,
      startDate: "2030-06-18",
      endDate: "2030-06-20",
    });
    const inside = await loan({
      itemId,
      borrower: strangerId,
      startDate: "2030-06-21",
      endDate: "2030-06-25",
    });
    const adjacent = await loan({
      itemId,
      borrower: otherBorrowerId,
      startDate: "2030-06-23",
      endDate: "2030-06-24",
    });
    // Stored requested, start passed: expired, left as it is.
    const expired = await loan({
      itemId,
      borrower: strangerId,
      startDate: YESTERDAY,
      endDate: "2030-06-21",
    });
    const elsewhere = await loan({
      borrower: otherBorrowerId,
      startDate: "2030-06-20",
      endDate: "2030-06-22",
    });
    const before = Date.now();

    expect(await approveLoanRequest(ownerId, target.id, TODAY)).toBe(
      "approved",
    );

    for (const { id } of [edge, inside]) {
      const swept = await row(id);
      expect(swept).toMatchObject({
        status: "declined",
        endedBy: "system",
        systemReason: "dates_taken",
        statusReason: null,
      });
      expectRecent(swept.changedAt, before);
      expectRecent(swept.ownerSeenAt, before);
      expect(swept.borrowerSeenAt).toEqual(OLD);
    }
    for (const { id } of [adjacent, expired, elsewhere]) {
      await expectUnchanged(id, "requested");
    }
  });

  test("a fixture approved loan overlapping → datesTaken; the request and the others stay requested", async () => {
    const itemId = await item();
    await loan({
      itemId,
      status: "approved",
      borrower: strangerId,
      startDate: "2030-06-20",
      endDate: "2030-06-22",
    });
    const target = await loan({
      itemId,
      startDate: "2030-06-21",
      endDate: "2030-06-21",
    });
    const other = await loan({
      itemId,
      borrower: otherBorrowerId,
      startDate: "2030-06-21",
      endDate: "2030-06-23",
    });

    expect(await approveLoanRequest(ownerId, target.id, TODAY)).toBe(
      "datesTaken",
    );
    await expectUnchanged(target.id, "requested");
    await expectUnchanged(other.id, "requested");
  });
});

describe("declineLoanRequest", () => {
  test("the owner on a request → declined by the owner, with the reason", async () => {
    const { id } = await loan();
    const before = Date.now();

    expect(await declineLoanRequest(ownerId, id, "Away that week", TODAY)).toBe(
      "declined",
    );

    const after = await row(id);
    expect(after).toMatchObject({
      status: "declined",
      endedBy: "owner",
      systemReason: null,
      statusReason: "Away that week",
    });
    expectRecent(after.changedAt, before);
    expectRecent(after.ownerSeenAt, before);
    expect(after.borrowerSeenAt).toEqual(OLD);
  });

  test("no reason is stored as null", async () => {
    const { id } = await loan();
    await declineLoanRequest(ownerId, id, null, TODAY);
    expect((await row(id)).statusReason).toBeNull();
  });

  test.each<[string, () => string, LoanFixture]>([
    ["the borrower", () => borrowerId, {}],
    ["a non-party organizer", () => organizerId, {}],
    ["the owner, an approved loan", () => ownerId, { status: "approved" }],
    ["the owner, an expired request", () => ownerId, { startDate: YESTERDAY }],
  ])("%s → stale, nothing written", async (_, actor, fixture) => {
    const { id } = await loan(fixture);
    expect(await declineLoanRequest(actor(), id, "No", TODAY)).toBe("stale");
    await expectUnchanged(id, fixture.status ?? "requested");
  });
});

describe("cancelLoanByParty", () => {
  test.each<[string, LoanStatus, "owner" | "borrower"]>([
    ["the borrower, a request", "requested", "borrower"],
    ["the borrower, an approved loan", "approved", "borrower"],
    ["the owner, an approved loan", "approved", "owner"],
  ])(
    "%s → cancelled by that party, only their seen-at",
    async (_, status, party) => {
      const { id } = await loan({ status });
      const actor = party === "owner" ? ownerId : borrowerId;
      const stage = status === "requested" ? "request" : "loan";
      const before = Date.now();

      expect(
        await cancelLoanByParty(actor, id, stage, "Plans changed", TODAY),
      ).toBe("cancelled");

      const after = await row(id);
      expect(after).toMatchObject({
        status: "cancelled",
        endedBy: party,
        systemReason: null,
        statusReason: "Plans changed",
      });
      expectRecent(after.changedAt, before);
      const [mine, theirs] =
        party === "owner"
          ? [after.ownerSeenAt, after.borrowerSeenAt]
          : [after.borrowerSeenAt, after.ownerSeenAt];
      expectRecent(mine, before);
      expect(theirs).toEqual(OLD);
    },
  );

  test.each<[string, () => string, LoanFixture]>([
    ["the owner, a request", () => ownerId, {}],
    [
      "the borrower, a lapsed approval",
      () => borrowerId,
      { status: "approved", startDate: "2030-06-10", endDate: YESTERDAY },
    ],
    [
      "the borrower, an out loan",
      () => borrowerId,
      { status: "out", startDate: "2030-06-10", endDate: "2030-06-20" },
    ],
    [
      "the owner, an overdue loan",
      () => ownerId,
      { status: "out", startDate: "2030-06-10", endDate: YESTERDAY },
    ],
    [
      "the borrower, a returned loan",
      () => borrowerId,
      { status: "returned", startDate: "2030-06-10", endDate: YESTERDAY },
    ],
    ["a non-party organizer", () => organizerId, { status: "approved" }],
    ["a non-party member", () => strangerId, { status: "approved" }],
  ])("%s → stale, nothing written", async (_, actor, fixture) => {
    const { id } = await loan(fixture);
    // Either stage: neither cancel is open to this actor on this loan.
    for (const stage of ["request", "loan"] as const) {
      expect(await cancelLoanByParty(actor(), id, stage, null, TODAY)).toBe(
        "stale",
      );
    }
    await expectUnchanged(id, fixture.status ?? "requested");
  });

  test.each<[string, LoanStatus, "request" | "loan"]>([
    ["Cancel request, the loan approved since", "approved", "request"],
    ["Cancel loan, still a request", "requested", "loan"],
  ])("the borrower's %s → stale, nothing written", async (_, status, stage) => {
    const { id } = await loan({ status });
    expect(await cancelLoanByParty(borrowerId, id, stage, null, TODAY)).toBe(
      "stale",
    );
    await expectUnchanged(id, status);
  });
});

describe("getLoanForViewer — actions", () => {
  const as = (id: string, role: "member" | "organizer" = "member") => ({
    id,
    role,
  });

  test.each<
    [
      string,
      () => { id: string; role: "member" | "organizer" },
      LoanFixture,
      LoanAction[],
    ]
  >([
    ["owner, request", () => as(ownerId), {}, ["approve", "decline"]],
    [
      "owner, request on a hidden item",
      () => as(ownerId),
      { itemStatus: "hidden" },
      ["decline"],
    ],
    [
      "owner, request from a gone borrower",
      () => as(ownerId),
      { borrower: null },
      ["decline"],
    ],
    ["borrower, request", () => as(borrowerId), {}, ["cancel"]],
    ["owner, approved", () => as(ownerId), { status: "approved" }, ["cancel"]],
    [
      "borrower, approved",
      () => as(borrowerId),
      { status: "approved" },
      ["cancel"],
    ],
    ["owner, expired", () => as(ownerId), { startDate: YESTERDAY }, []],
    [
      "borrower, lapsed",
      () => as(borrowerId),
      { status: "approved", startDate: "2030-06-10", endDate: YESTERDAY },
      [],
    ],
    [
      "owner, out",
      () => as(ownerId),
      { status: "out", startDate: "2030-06-10" },
      ["mark_returned"],
    ],
    [
      "borrower, overdue",
      () => as(borrowerId),
      { status: "out", startDate: "2030-06-10", endDate: YESTERDAY },
      [],
    ],
    [
      "owner, returned",
      () => as(ownerId),
      { status: "returned", startDate: "2030-06-10", endDate: YESTERDAY },
      [],
    ],
    ["owner, declined", () => as(ownerId), { status: "declined" }, []],
    ["borrower, cancelled", () => as(borrowerId), { status: "cancelled" }, []],
    [
      "non-party organizer, request",
      () => as(organizerId, "organizer"),
      {},
      [],
    ],
    [
      "non-party organizer, approved",
      () => as(organizerId, "organizer"),
      { status: "approved" },
      [],
    ],
  ])("%s → %j", async (_, viewer, fixture, actions) => {
    const { id } = await loan(fixture);
    expect((await getLoanForViewer(viewer(), id, TODAY))?.actions).toEqual(
      actions,
    );
  });

  // Built here, not in the table: the ids exist only after beforeAll.
  test("an organizer who is a party gets that party's actions", async () => {
    const organizer = as(organizerId, "organizer");
    const borrowing = await loan({ borrower: organizerId });
    const lending = await loan({ owner: organizerId });

    expect(
      (await getLoanForViewer(organizer, borrowing.id, TODAY))?.actions,
    ).toEqual(["cancel"]);
    expect(
      (await getLoanForViewer(organizer, lending.id, TODAY))?.actions,
    ).toEqual(["approve", "decline"]);
  });
});

// Every contender queues behind a held item row, so they really overlap.
describe("concurrency (held item row)", () => {
  test("(a) two overlapping requests approved at once → one approved, the other declined dates_taken", async () => {
    const itemId = await item();
    const first = await loan({
      itemId,
      startDate: "2030-06-20",
      endDate: "2030-06-22",
    });
    const second = await loan({
      itemId,
      borrower: otherBorrowerId,
      startDate: "2030-06-21",
      endDate: "2030-06-23",
    });
    const hold = holdRow("item", itemId);
    await hold.held;

    const outcomes = Promise.all([
      approveLoanRequest(ownerId, first.id, TODAY),
      approveLoanRequest(ownerId, second.id, TODAY),
    ]);
    await hold.queued(2);
    hold.release();
    const [results] = await Promise.all([outcomes, hold.done]);

    expect([...results].sort()).toEqual(["approved", "stale"]);
    const rows = await Promise.all([row(first.id), row(second.id)]);
    expect(rows.map((r) => r.status).sort()).toEqual(["approved", "declined"]);
    expect(rows.find((r) => r.status === "declined")).toMatchObject({
      endedBy: "system",
      systemReason: "dates_taken",
    });
  });

  test("(b) the same request approved twice → approved once, stale once", async () => {
    const { id, itemId } = await loan();
    const hold = holdRow("item", itemId);
    await hold.held;

    const outcomes = Promise.all([
      approveLoanRequest(ownerId, id, TODAY),
      approveLoanRequest(ownerId, id, TODAY),
    ]);
    await hold.queued(2);
    hold.release();
    const [results] = await Promise.all([outcomes, hold.done]);

    expect([...results].sort()).toEqual(["approved", "stale"]);
    expect((await row(id)).status).toBe("approved");
  });

  // Queued in a set order; the second to run re-reads a changed loan.
  const rivals = {
    "(c) the owner's decline": (id: string) =>
      declineLoanRequest(ownerId, id, null, TODAY),
    "(d) the borrower's Cancel request": (id: string) =>
      cancelLoanByParty(borrowerId, id, "request", null, TODAY),
  };

  describe.each(Object.entries(rivals))("approve vs %s", (_, rival) => {
    test("approve queued first → approved; the rival is stale", async () => {
      const { id, itemId } = await loan();
      const hold = holdRow("item", itemId);
      await hold.held;

      const approved = approveLoanRequest(ownerId, id, TODAY);
      await hold.queued(1);
      const other = rival(id);
      await hold.queued(2);
      hold.release();
      const [approval, outcome] = await Promise.all([
        approved,
        other,
        hold.done,
      ]);

      expect(approval).toBe("approved");
      expect(outcome).toBe("stale");
      expect((await row(id)).status).toBe("approved");
    });

    test("the rival queued first → it wins; approve is stale", async () => {
      const { id, itemId } = await loan();
      const hold = holdRow("item", itemId);
      await hold.held;

      const other = rival(id);
      await hold.queued(1);
      const approved = approveLoanRequest(ownerId, id, TODAY);
      await hold.queued(2);
      hold.release();
      const [outcome, approval] = await Promise.all([
        other,
        approved,
        hold.done,
      ]);

      expect(outcome).not.toBe("stale");
      expect(approval).toBe("stale");
      expect((await row(id)).status).toBe(outcome);
    });
  });
});

describe("approve vs a new request (held item row)", () => {
  // A fresh requester each time: the shared borrowers' open requests from
  // other tests would otherwise hit the request limits.
  const requester = () => user({ contactDetails: "Requester phone" });
  const newRequest = (requesterId: string, itemId: string) =>
    insertLoanRequest(
      requesterId,
      { itemId, startDate: "2030-06-21", endDate: "2030-06-21", message: null },
      TODAY,
    );

  test("the request queued first → created, then the approval's sweep declines it", async () => {
    const { id, itemId } = await loan();
    const me = await requester();
    const hold = holdRow("item", itemId);
    await hold.held;

    const requested = newRequest(me, itemId);
    await hold.queued(1);
    const approved = approveLoanRequest(ownerId, id, TODAY);
    await hold.queued(2);
    hold.release();
    const [outcome, approval] = await Promise.all([
      requested,
      approved,
      hold.done,
    ]);

    expect(approval).toBe("approved");
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(await row(outcome.id)).toMatchObject({
      status: "declined",
      systemReason: "dates_taken",
    });
  });

  test("the approval queued first → the waiting request is refused datesTaken", async () => {
    const { id, itemId } = await loan();
    const me = await requester();
    const hold = holdRow("item", itemId);
    await hold.held;

    const approved = approveLoanRequest(ownerId, id, TODAY);
    await hold.queued(1);
    const requested = newRequest(me, itemId);
    await hold.queued(2);
    hold.release();
    const [approval, outcome] = await Promise.all([
      approved,
      requested,
      hold.done,
    ]);

    expect(approval).toBe("approved");
    expect(outcome.kind).toBe("datesTaken");
    expect(await db.loan.count({ where: { itemId, borrowerId: me } })).toBe(0);
  });
});

describe("approve vs hide (held item row)", () => {
  test("hide queued first → the request is declined item_hidden, the approval is stale", async () => {
    const { id, itemId } = await loan();
    const hold = holdRow("item", itemId);
    await hold.held;

    const hidden = hideOwnItem(ownerId, itemId, TODAY);
    await hold.queued(1);
    const approved = approveLoanRequest(ownerId, id, TODAY);
    await hold.queued(2);
    hold.release();
    const [hide, approval] = await Promise.all([hidden, approved, hold.done]);

    expect(hide).toBe("hidden");
    expect(approval).toBe("stale");
    expect(await row(id)).toMatchObject({
      status: "declined",
      systemReason: "item_hidden",
    });
  });

  test("approve queued first → approved and kept; hide declines only the other open request", async () => {
    const { id, itemId } = await loan();
    const other = await loan({
      itemId,
      borrower: otherBorrowerId,
      startDate: "2030-06-25",
      endDate: "2030-06-26",
    });
    const hold = holdRow("item", itemId);
    await hold.held;

    const approved = approveLoanRequest(ownerId, id, TODAY);
    await hold.queued(1);
    const hidden = hideOwnItem(ownerId, itemId, TODAY);
    await hold.queued(2);
    hold.release();
    const [approval, hide] = await Promise.all([approved, hidden, hold.done]);

    expect(approval).toBe("approved");
    expect(hide).toBe("hidden");
    expect((await row(id)).status).toBe("approved");
    expect(await row(other.id)).toMatchObject({
      status: "declined",
      systemReason: "item_hidden",
    });
  });
});
