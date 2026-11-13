import { randomUUID } from "node:crypto";
import { holdRow } from "@/__tests__/support/hold-row";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { getItemForViewer } from "@/data/browse";
import { fromDbDate } from "@/data/db-dates";
import { getOwnItems } from "@/data/items";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import type { LoanAction } from "@/types/loan";
import {
  cancelLoanByParty,
  getLoanForViewer,
  handOverLoan,
  markLoanBack,
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
const TOMORROW = "2030-06-16";
// Every fixture starts "seen and changed" long ago, so a write is visible.
const OLD = new Date("2030-01-01T00:00:00Z");
let ownerId: string;
let borrowerId: string;
let organizerId: string;
let strangerId: string;

beforeAll(async () => {
  await assertMigrated();
  [ownerId, borrowerId, organizerId, strangerId] = await Promise.all([
    user({ name: "Olga M.", contactDetails: "Owner phone" }),
    user({ name: "Ana P.", contactDetails: "Borrower phone" }),
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

// Defaults to an approved loan starting today: one a handover accepts.
async function loan({
  itemId,
  status = "approved",
  startDate = TODAY,
  endDate = "2030-06-17",
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

// Out since the 10th, due back the 12th: overdue on TODAY.
const overdue = (itemId?: string) =>
  loan({
    itemId,
    status: "out",
    startDate: "2030-06-10",
    endDate: "2030-06-12",
  });

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

const outOnItem = (itemId: string) =>
  db.loan.count({ where: { itemId, status: "out" } });

describe("handOverLoan", () => {
  test("the owner on an approved loan starting today → out; only status, changedAt and the owner's seen-at move", async () => {
    const { id } = await loan();
    const before = Date.now();

    expect(await handOverLoan(ownerId, id, TODAY)).toBe("handedOver");

    const after = await row(id);
    expect(after).toMatchObject({
      status: "out",
      endedBy: null,
      systemReason: null,
      statusReason: null,
      returnedOn: null,
      returnedAsLent: null,
      borrowerSeenAt: OLD,
    });
    expectRecent(after.changedAt, before);
    expectRecent(after.ownerSeenAt, before);
  });

  test("a loan that started earlier and ends today hands over", async () => {
    const { id } = await loan({ startDate: "2030-06-12", endDate: TODAY });
    expect(await handOverLoan(ownerId, id, TODAY)).toBe("handedOver");
  });

  test.each<[string, LoanFixture]>([
    ["starting tomorrow", { startDate: TOMORROW, endDate: "2030-06-18" }],
    [
      "lapsed (ended yesterday)",
      { startDate: "2030-06-12", endDate: YESTERDAY },
    ],
    ["a request", { status: "requested", startDate: TOMORROW }],
    ["already out", { status: "out" }],
    [
      "returned",
      { status: "returned", startDate: "2030-06-10", endDate: YESTERDAY },
    ],
    ["cancelled", { status: "cancelled" }],
    ["with a gone borrower", { borrower: null }],
  ])("%s → stale, nothing written", async (_, fixture) => {
    const { id } = await loan(fixture);
    expect(await handOverLoan(ownerId, id, TODAY)).toBe("stale");
    await expectUnchanged(id, fixture.status ?? "approved");
  });

  test.each([
    ["the borrower", () => borrowerId],
    ["a non-party member", () => strangerId],
    ["a non-party organizer", () => organizerId],
  ])("%s → stale, nothing written", async (_, actor) => {
    const { id } = await loan();
    expect(await handOverLoan(actor(), id, TODAY)).toBe("stale");
    await expectUnchanged(id, "approved");
  });

  test("an unknown id → stale", async () => {
    expect(await handOverLoan(ownerId, randomUUID(), TODAY)).toBe("stale");
  });

  test("a hidden item still hands over: hiding leaves approved loans running", async () => {
    const { id } = await loan({ itemStatus: "hidden" });
    expect(await handOverLoan(ownerId, id, TODAY)).toBe("handedOver");
  });
});

// OQ-34: an out loan occupies its item until it is marked back.
describe("handOverLoan — the item is still out", () => {
  test("an overdue loan on the item → stillOut, nothing written", async () => {
    const held = await overdue();
    const { id } = await loan({ itemId: held.itemId });

    expect(await handOverLoan(ownerId, id, TODAY)).toBe("stillOut");
    await expectUnchanged(id, "approved");
  });

  test("an out loan on the item that isn't due yet → stillOut", async () => {
    const held = await loan({
      status: "out",
      startDate: "2030-06-20",
      endDate: "2030-06-22",
    });
    const { id } = await loan({ itemId: held.itemId, endDate: TODAY });

    expect(await handOverLoan(ownerId, id, TODAY)).toBe("stillOut");
    await expectUnchanged(id, "approved");
  });

  test("an out loan on a different item doesn't block", async () => {
    await overdue();
    const { id } = await loan();
    expect(await handOverLoan(ownerId, id, TODAY)).toBe("handedOver");
  });

  test("marking the overdue loan back lets the waiting loan hand over", async () => {
    const held = await overdue();
    const { id } = await loan({ itemId: held.itemId });
    expect(await handOverLoan(ownerId, id, TODAY)).toBe("stillOut");

    expect(
      await markLoanBack(
        ownerId,
        { id: held.id, returnedOn: TODAY, asLent: "yes" },
        TODAY,
      ),
    ).toBe("returned");
    expect(await handOverLoan(ownerId, id, TODAY)).toBe("handedOver");
    expect(await outOnItem(held.itemId)).toBe(1);
  });
});

describe("markLoanBack", () => {
  test("the owner on an out loan → returned as submitted; endedBy and closedById stay null", async () => {
    const { id } = await loan({ status: "out", startDate: "2030-06-12" });
    const before = Date.now();

    expect(
      await markLoanBack(
        ownerId,
        { id, returnedOn: TODAY, asLent: "yes" },
        TODAY,
      ),
    ).toBe("returned");

    const after = await row(id);
    expect(after).toMatchObject({
      status: "returned",
      returnedAsLent: "yes",
      endedBy: null,
      closedById: null,
      borrowerSeenAt: OLD,
    });
    expect(fromDbDate(after.returnedOn)).toBe(TODAY);
    expectRecent(after.changedAt, before);
    expectRecent(after.ownerSeenAt, before);
  });

  test("the owner on an overdue loan, back on its start date, not as lent → returned", async () => {
    const { id } = await overdue();

    expect(
      await markLoanBack(
        ownerId,
        { id, returnedOn: "2030-06-10", asLent: "no" },
        TODAY,
      ),
    ).toBe("returned");

    const after = await row(id);
    expect(after.returnedAsLent).toBe("no");
    expect(fromDbDate(after.returnedOn)).toBe("2030-06-10");
  });

  test("a return date the day before the start → beforeStart, nothing written", async () => {
    const { id } = await overdue();
    expect(
      await markLoanBack(
        ownerId,
        { id, returnedOn: "2030-06-09", asLent: "yes" },
        TODAY,
      ),
    ).toBe("beforeStart");
    await expectUnchanged(id, "out");
  });

  test.each<[string, () => string, LoanFixture]>([
    ["the borrower", () => borrowerId, { status: "out" }],
    ["a non-party organizer", () => organizerId, { status: "out" }],
    ["the owner of an approved loan", () => ownerId, {}],
    [
      "the owner of a returned loan",
      () => ownerId,
      { status: "returned", startDate: "2030-06-10", endDate: YESTERDAY },
    ],
  ])("%s → stale, nothing written", async (_, actor, fixture) => {
    const { id } = await loan(fixture);
    expect(
      await markLoanBack(
        actor(),
        { id, returnedOn: TODAY, asLent: "yes" },
        TODAY,
      ),
    ).toBe("stale");
    await expectUnchanged(id, fixture.status ?? "approved");
  });

  test("an unknown id → stale", async () => {
    expect(
      await markLoanBack(
        ownerId,
        { id: randomUUID(), returnedOn: TODAY, asLent: "yes" },
        TODAY,
      ),
    ).toBe("stale");
  });
});

// Overdue is never stored: hand over for real, then read on later days.
describe("the derived chain", () => {
  test("out → with, back today, overdue → marked back clears every read", async () => {
    const owner = await user({ name: "Mila T.", contactDetails: "Mila phone" });
    const { id, itemId } = await loan({ owner, endDate: TOMORROW });
    const later = "2030-06-18";
    const stranger = { id: strangerId, role: "member" as const };
    const nowOf = async (today: string) =>
      (await getOwnItems(owner, today)).rows.find((r) => r.id === itemId)?.now
        .kind;

    expect(await handOverLoan(owner, id, TODAY)).toBe("handedOver");
    expect(await nowOf(TODAY)).toBe("with");
    expect(await nowOf(TOMORROW)).toBe("back_today");

    const loanLater = await getLoanForViewer(
      { id: owner, role: "member" },
      id,
      later,
    );
    expect(loanLater?.status).toBe("overdue");
    const itemLater = await getItemForViewer(stranger, itemId, later);
    expect(itemLater?.freeToday).toBe(false);
    expect(itemLater?.bookedRanges).toEqual([
      { startDate: TODAY, endDate: TOMORROW, stillOut: true },
    ]);
    expect(await nowOf(later)).toBe("overdue");

    expect(
      await markLoanBack(
        owner,
        { id, returnedOn: later, asLent: "yes" },
        later,
      ),
    ).toBe("returned");

    expect(
      (await getLoanForViewer({ id: owner, role: "member" }, id, later))
        ?.status,
    ).toBe("returned");
    const itemAfter = await getItemForViewer(stranger, itemId, later);
    expect(itemAfter?.freeToday).toBe(true);
    expect(itemAfter?.bookedRanges).toEqual([]);
    expect(["with", "back_today", "overdue"]).not.toContain(await nowOf(later));
  });
});

describe("getLoanForViewer — hand over and return", () => {
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
    [
      "owner, approved from today",
      () => as(ownerId),
      {},
      ["hand_over", "cancel"],
    ],
    [
      "owner, approved since earlier, ending today",
      () => as(ownerId),
      { startDate: "2030-06-12", endDate: TODAY },
      ["hand_over", "cancel"],
    ],
    [
      "owner, approved from tomorrow",
      () => as(ownerId),
      { startDate: TOMORROW },
      ["cancel"],
    ],
    [
      "owner, approved from today with a gone borrower",
      () => as(ownerId),
      { borrower: null },
      ["cancel"],
    ],
    ["borrower, approved from today", () => as(borrowerId), {}, ["cancel"]],
    ["owner, out", () => as(ownerId), { status: "out" }, ["mark_returned"]],
    [
      "owner, overdue",
      () => as(ownerId),
      { status: "out", startDate: "2030-06-10", endDate: YESTERDAY },
      ["mark_returned"],
    ],
    ["borrower, out", () => as(borrowerId), { status: "out" }, []],
    [
      "borrower, overdue",
      () => as(borrowerId),
      { status: "out", startDate: "2030-06-10", endDate: YESTERDAY },
      [],
    ],
    [
      "non-party organizer, approved from today",
      () => as(organizerId, "organizer"),
      {},
      [],
    ],
    [
      "non-party organizer, out",
      () => as(organizerId, "organizer"),
      { status: "out" },
      [],
    ],
  ])("%s → %j, not blocked", async (_, viewer, fixture, actions) => {
    const { id } = await loan(fixture);
    const dto = await getLoanForViewer(viewer(), id, TODAY);
    expect(dto?.actions).toEqual(actions);
    expect(dto?.handOverBlocked).toBe(false);
  });

  test("another loan on the item still out: the owner is blocked; the borrower and an organizer aren't", async () => {
    const held = await overdue();
    const { id } = await loan({ itemId: held.itemId });

    const owner = await getLoanForViewer(as(ownerId), id, TODAY);
    expect(owner?.actions).toEqual(["cancel"]);
    expect(owner?.handOverBlocked).toBe(true);

    for (const viewer of [as(borrowerId), as(organizerId, "organizer")]) {
      const dto = await getLoanForViewer(viewer, id, TODAY);
      expect(dto?.handOverBlocked).toBe(false);
    }
  });

  test("a null borrower is never blocked, even with another loan out", async () => {
    const held = await overdue();
    const { id } = await loan({ itemId: held.itemId, borrower: null });
    const dto = await getLoanForViewer(as(ownerId), id, TODAY);
    expect(dto?.actions).toEqual(["cancel"]);
    expect(dto?.handOverBlocked).toBe(false);
  });

  test("an approval starting tomorrow isn't blocked yet, even with another loan out", async () => {
    const held = await overdue();
    const { id } = await loan({
      itemId: held.itemId,
      startDate: TOMORROW,
      endDate: "2030-06-18",
    });
    const dto = await getLoanForViewer(as(ownerId), id, TODAY);
    expect(dto?.actions).toEqual(["cancel"]);
    expect(dto?.handOverBlocked).toBe(false);
  });

  // Built here, not in the table: the ids exist only after beforeAll.
  test("an organizer who owns the item gets the owner's controls", async () => {
    const organizer = as(organizerId, "organizer");
    const approved = await loan({ owner: organizerId });
    const out = await loan({ owner: organizerId, status: "out" });

    expect(
      (await getLoanForViewer(organizer, approved.id, TODAY))?.actions,
    ).toEqual(["hand_over", "cancel"]);
    expect((await getLoanForViewer(organizer, out.id, TODAY))?.actions).toEqual(
      ["mark_returned"],
    );
  });
});

// Every contender queues behind a held item row, so they really overlap.
describe("concurrency (held item row)", () => {
  const giveBack = (id: string) =>
    markLoanBack(ownerId, { id, returnedOn: TODAY, asLent: "yes" }, TODAY);

  test("the return queued first → both succeed", async () => {
    const held = await overdue();
    const waiting = await loan({ itemId: held.itemId });
    const hold = holdRow("item", held.itemId);
    await hold.held;

    const returned = giveBack(held.id);
    await hold.queued(1);
    const handedOver = handOverLoan(ownerId, waiting.id, TODAY);
    await hold.queued(2);
    hold.release();
    const [back, out] = await Promise.all([returned, handedOver, hold.done]);

    expect(back).toBe("returned");
    expect(out).toBe("handedOver");
    expect(await outOnItem(held.itemId)).toBe(1);
  });

  test("the handover queued first → stillOut; the return still lands", async () => {
    const held = await overdue();
    const waiting = await loan({ itemId: held.itemId });
    const hold = holdRow("item", held.itemId);
    await hold.held;

    const handedOver = handOverLoan(ownerId, waiting.id, TODAY);
    await hold.queued(1);
    const returned = giveBack(held.id);
    await hold.queued(2);
    hold.release();
    const [out, back] = await Promise.all([handedOver, returned, hold.done]);

    expect(out).toBe("stillOut");
    expect(back).toBe("returned");
    expect((await row(waiting.id)).status).toBe("approved");
    expect(await outOnItem(held.itemId)).toBe(0);
  });

  test("the same loan handed over twice → handedOver once, stale once", async () => {
    const { id, itemId } = await loan();
    const hold = holdRow("item", itemId);
    await hold.held;

    const outcomes = Promise.all([
      handOverLoan(ownerId, id, TODAY),
      handOverLoan(ownerId, id, TODAY),
    ]);
    await hold.queued(2);
    hold.release();
    const [results] = await Promise.all([outcomes, hold.done]);

    expect([...results].sort()).toEqual(["handedOver", "stale"]);
    expect((await row(id)).status).toBe("out");
  });

  test("the same loan marked back twice → returned once, stale once", async () => {
    const { id, itemId } = await overdue();
    const hold = holdRow("item", itemId);
    await hold.held;

    const outcomes = Promise.all([giveBack(id), giveBack(id)]);
    await hold.queued(2);
    hold.release();
    const [results] = await Promise.all([outcomes, hold.done]);

    expect([...results].sort()).toEqual(["returned", "stale"]);
    expect((await row(id)).status).toBe("returned");
  });

  // Queued in a set order; the second to run re-reads a changed loan.
  const cancels = {
    "the owner's Cancel loan": (id: string) =>
      cancelLoanByParty(ownerId, id, "loan", null, TODAY),
    "the borrower's Cancel loan": (id: string) =>
      cancelLoanByParty(borrowerId, id, "loan", null, TODAY),
  };

  describe.each(Object.entries(cancels))("handover vs %s", (_, cancel) => {
    test("handover queued first → out; the cancel is stale", async () => {
      const { id, itemId } = await loan();
      const hold = holdRow("item", itemId);
      await hold.held;

      const handedOver = handOverLoan(ownerId, id, TODAY);
      await hold.queued(1);
      const cancelled = cancel(id);
      await hold.queued(2);
      hold.release();
      const [out, other] = await Promise.all([
        handedOver,
        cancelled,
        hold.done,
      ]);

      expect(out).toBe("handedOver");
      expect(other).toBe("stale");
      expect((await row(id)).status).toBe("out");
    });

    test("the cancel queued first → cancelled; the handover is stale", async () => {
      const { id, itemId } = await loan();
      const hold = holdRow("item", itemId);
      await hold.held;

      const cancelled = cancel(id);
      await hold.queued(1);
      const handedOver = handOverLoan(ownerId, id, TODAY);
      await hold.queued(2);
      hold.release();
      const [other, out] = await Promise.all([
        cancelled,
        handedOver,
        hold.done,
      ]);

      expect(other).toBe("cancelled");
      expect(out).toBe("stale");
      expect((await row(id)).status).toBe("cancelled");
    });
  });
});
