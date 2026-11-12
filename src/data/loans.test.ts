import { holdRow } from "@/__tests__/support/hold-row";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { updateOwnContactDetails } from "@/data/account";
import { hideOwnItem } from "@/data/items";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import { people } from "@/strings/people";
import type { LoanDetailDTO } from "@/types/loan";
import { getLoanForViewer, insertLoanRequest } from "./loans";

vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const TODAY = "2030-06-15";
let ownerId: string;
let borrowerId: string;
let organizerId: string;
let strangerId: string;

beforeAll(async () => {
  await assertMigrated();
  [ownerId, borrowerId, organizerId, strangerId] = await Promise.all([
    user({ name: "Olga M.", contactDetails: "Owner phone 555" }),
    user({ name: "Ana P.", contactDetails: "Borrower phone 777" }),
    user({ name: "Ivo K.", role: "organizer" }),
    user({ name: "Sara L." }),
  ]);
});
afterAll(() => scope.cleanup());

async function user(options: Parameters<typeof scope.createTestUser>[0]) {
  return (await scope.createTestUser(options)).id;
}

const as = (id: string, role: "member" | "organizer" = "member") => ({
  id,
  role,
});

async function listed(
  owner: string | null = ownerId,
  status: ItemStatus = "listed",
) {
  return (await scope.createItem({ ownerId: owner, status })).id;
}

const request = (
  borrower: string,
  itemId: string,
  startDate = "2030-06-20",
  endDate = "2030-06-21",
) =>
  insertLoanRequest(
    borrower,
    { itemId, startDate, endDate, message: null },
    TODAY,
  );

const loanRow = (id: string) => db.loan.findUniqueOrThrow({ where: { id } });

describe("insertLoanRequest — concurrency (held rows)", () => {
  test("a request holding the actor row → the concurrent clear is refused locked", async () => {
    const me = await user({ contactDetails: "Phone 1" });
    const itemId = await listed();
    const hold = holdRow("item", itemId);
    await hold.held;

    const requested = request(me, itemId);
    await hold.queued(1);
    const clear = updateOwnContactDetails(me, null, TODAY);
    await hold.queued(2);
    hold.release();
    const [outcome, cleared] = await Promise.all([requested, clear, hold.done]);

    expect(outcome.kind).toBe("created");
    expect(cleared).toBe("locked");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: me } })).contactDetails,
    ).toBe("Phone 1");
  });

  test("a clear queued first → the request returns needsContactDetails", async () => {
    const me = await user({ contactDetails: "Phone 2" });
    const itemId = await listed();
    const hold = holdRow("user", me);
    await hold.held;

    const clear = updateOwnContactDetails(me, null, TODAY);
    await hold.queued(1);
    const requested = request(me, itemId);
    await hold.queued(2);
    hold.release();
    const [cleared, outcome] = await Promise.all([clear, requested, hold.done]);

    expect(cleared).toBe("saved");
    expect(outcome).toEqual({ kind: "needsContactDetails" });
    expect(await db.loan.count({ where: { borrowerId: me } })).toBe(0);
  });

  test("hideOwnItem holding the item → the request returns stale", async () => {
    const me = await user({ contactDetails: "Phone 3" });
    const itemId = await listed();
    const hold = holdRow("item", itemId);
    await hold.held;

    const hide = hideOwnItem(ownerId, itemId, TODAY);
    await hold.queued(1);
    const requested = request(me, itemId);
    await hold.queued(2);
    hold.release();
    const [hidden, outcome] = await Promise.all([hide, requested, hold.done]);

    expect(hidden).toBe("hidden");
    expect(outcome).toEqual({ kind: "stale" });
    expect(await db.loan.count({ where: { itemId } })).toBe(0);
  });

  test("a request holding the item → the hide declines the new request", async () => {
    const me = await user({ contactDetails: "Phone 4" });
    const itemId = await listed();
    const hold = holdRow("item", itemId);
    await hold.held;

    const requested = request(me, itemId);
    await hold.queued(1);
    const hide = hideOwnItem(ownerId, itemId, TODAY);
    await hold.queued(2);
    hold.release();
    const [outcome, hidden] = await Promise.all([requested, hide, hold.done]);

    expect(hidden).toBe("hidden");
    if (outcome.kind !== "created") throw new Error(outcome.kind);
    expect(await loanRow(outcome.id)).toMatchObject({
      status: "declined",
      endedBy: "system",
      systemReason: "item_hidden",
    });
  });

  test("two same-member requests on one item at once → one created, one itemLimit", async () => {
    const me = await user({ contactDetails: "Phone 5" });
    const itemId = await listed();
    const hold = holdRow("user", me);
    await hold.held;

    const first = request(me, itemId);
    const second = request(me, itemId, "2030-06-25", "2030-06-26");
    await hold.queued(2);
    hold.release();
    const outcomes = await Promise.all([first, second]);
    await hold.done;

    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "created",
      "itemLimit",
    ]);
    expect(await db.loan.count({ where: { borrowerId: me, itemId } })).toBe(1);
  });

  test("four open requests plus two concurrent ones on other items → one created, one overallLimit", async () => {
    const me = await user({ contactDetails: "Phone 6" });
    for (let n = 0; n < 4; n++) {
      await scope.createLoan({
        itemId: await listed(),
        borrowerId: me,
        status: "requested",
        startDate: "2030-06-20",
        endDate: "2030-06-21",
      });
    }
    const [a, b] = [await listed(), await listed()];
    const hold = holdRow("user", me);
    await hold.held;

    const first = request(me, a);
    const second = request(me, b);
    await hold.queued(2);
    hold.release();
    const outcomes = await Promise.all([first, second]);
    await hold.done;

    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "created",
      "overallLimit",
    ]);
    expect(await db.loan.count({ where: { borrowerId: me } })).toBe(5);
  });
});

type Fixture = {
  status?: LoanStatus;
  startDate?: string;
  endDate?: string;
  returnedOn?: string;
  owner?: string | null;
  borrower?: string | null;
  itemStatus?: ItemStatus;
  extra?: Parameters<typeof scope.createLoan>[0] extends infer T
    ? Partial<T>
    : never;
};

// Each fixture on its own item, so approved/out ranges never meet the
// exclusion constraint.
async function fixture({
  status = "requested",
  startDate = "2030-06-20",
  endDate = "2030-06-22",
  returnedOn,
  owner = ownerId,
  borrower = borrowerId,
  itemStatus = "listed",
  extra = {},
}: Fixture = {}) {
  const itemId = await listed(owner, itemStatus);
  const { id } = await scope.createLoan({
    itemId,
    borrowerId: borrower,
    status,
    startDate,
    endDate,
    ...(returnedOn && { returnedOn }),
    ...extra,
  });
  return { id, itemId };
}

const view = (viewerId: string, loanId: string, role?: "organizer") =>
  getLoanForViewer(as(viewerId, role), loanId, TODAY);

describe("getLoanForViewer — access", () => {
  test("owner, borrower and a non-party organizer each get their role", async () => {
    const { id } = await fixture();
    expect((await view(ownerId, id))?.viewerRole).toBe("owner");
    expect((await view(borrowerId, id))?.viewerRole).toBe("borrower");
    expect((await view(organizerId, id, "organizer"))?.viewerRole).toBe(
      "organizer",
    );
  });

  test("an organizer who is a party gets the party role", async () => {
    const { id } = await fixture({ borrower: organizerId });
    expect((await view(organizerId, id, "organizer"))?.viewerRole).toBe(
      "borrower",
    );
  });

  test("a non-party member, an unknown id and a malformed id → null", async () => {
    const { id } = await fixture();
    expect(await view(strangerId, id)).toBeNull();
    expect(await view(ownerId, crypto.randomUUID())).toBeNull();
    expect(await view(ownerId, "not-a-loan-id")).toBeNull();
  });
});

describe("getLoanForViewer — seen-at", () => {
  test("each party writes only their own seen-at; changedAt never moves", async () => {
    const { id } = await fixture();
    const before = await loanRow(id);

    await view(ownerId, id);
    const afterOwner = await loanRow(id);
    expect(afterOwner.ownerSeenAt).not.toBeNull();
    expect(afterOwner.borrowerSeenAt).toBeNull();
    expect(afterOwner.changedAt).toEqual(before.changedAt);

    await view(borrowerId, id);
    const afterBorrower = await loanRow(id);
    expect(afterBorrower.borrowerSeenAt).not.toBeNull();
    expect(afterBorrower.ownerSeenAt).toEqual(afterOwner.ownerSeenAt);
    expect(afterBorrower.changedAt).toEqual(before.changedAt);
  });

  test("a non-party organizer and a refused viewer write nothing", async () => {
    const { id } = await fixture();
    const before = await loanRow(id);

    await view(organizerId, id, "organizer");
    await view(strangerId, id);

    expect(await loanRow(id)).toEqual(before);
  });
});

describe("getLoanForViewer — effective status", () => {
  test.each([
    ["requested", "2030-06-14", "2030-06-16", "expired"],
    ["approved", "2030-06-12", "2030-06-14", "lapsed"],
    ["out", "2030-06-12", "2030-06-14", "overdue"],
    ["requested", TODAY, "2030-06-16", "requested"],
  ] as const)(
    "stored %s from %s to %s reads %s",
    async (status, startDate, endDate, expected) => {
      const { id } = await fixture({ status, startDate, endDate });
      expect((await view(ownerId, id))?.status).toBe(expected);
    },
  );
});

describe("getLoanForViewer — contact details", () => {
  const owners = { name: "Olga M.", details: "Owner phone 555" };
  const borrowers = { name: "Ana P.", details: "Borrower phone 777" };

  test.each([
    ["approved", {}],
    ["out", {}],
    ["out (overdue)", { startDate: "2030-06-10", endDate: "2030-06-12" }],
    [
      "returned 7 days ago",
      {
        startDate: "2030-06-01",
        endDate: "2030-06-08",
        returnedOn: "2030-06-08",
      },
    ],
  ] as const)("%s → each party sees the other's", async (label, dates) => {
    const status = label.split(" ")[0] as LoanStatus;
    const { id } = await fixture({ status, ...dates });
    expect((await view(ownerId, id))?.contact).toEqual(borrowers);
    expect((await view(borrowerId, id))?.contact).toEqual(owners);
  });

  test.each([
    ["requested", {}],
    [
      "returned 8 days ago",
      {
        startDate: "2030-06-01",
        endDate: "2030-06-07",
        returnedOn: "2030-06-07",
      },
    ],
    ["declined", {}],
    ["cancelled", {}],
    ["requested (expired)", { startDate: "2030-06-14", endDate: "2030-06-16" }],
    ["approved (lapsed)", { startDate: "2030-06-12", endDate: "2030-06-14" }],
  ] as const)("%s → none for either party", async (label, dates) => {
    const status = label.split(" ")[0] as LoanStatus;
    const { id } = await fixture({ status, ...dates });
    expect((await view(ownerId, id))?.contact).toBeNull();
    expect((await view(borrowerId, id))?.contact).toBeNull();
  });

  test("the other party without details → none", async () => {
    const { id } = await fixture({ status: "approved", borrower: strangerId });
    expect((await view(ownerId, id))?.contact).toBeNull();
  });

  test("a non-party organizer never sees them, even on an out loan", async () => {
    const { id } = await fixture({ status: "out" });
    expect((await view(organizerId, id, "organizer"))?.contact).toBeNull();
  });
});

describe("getLoanForViewer — overlapping requests", () => {
  test("the owner of a requested loan counts other open overlapping requests; the borrower gets 0", async () => {
    const { id, itemId } = await fixture();
    const other = (startDate: string, endDate: string) =>
      scope.createLoan({
        itemId,
        borrowerId: strangerId,
        status: "requested",
        startDate,
        endDate,
      });
    await other("2030-06-21", "2030-06-23");
    await other("2030-06-18", "2030-06-20");
    await other("2030-06-23", "2030-06-24");
    await other("2030-06-10", "2030-06-21");

    expect((await view(ownerId, id))?.overlappingRequestCount).toBe(2);
    expect((await view(borrowerId, id))?.overlappingRequestCount).toBe(0);
  });
});

describe("getLoanForViewer — item link and names", () => {
  test("viewable: the owner always; others only for a listed item with an active owner", async () => {
    const suspended = await user({ status: "suspended" });
    const cases: [Fixture, string, boolean][] = [
      [{ itemStatus: "hidden" }, ownerId, true],
      [{}, borrowerId, true],
      [{ itemStatus: "hidden" }, borrowerId, false],
      [{ itemStatus: "retired" }, borrowerId, false],
      [{ owner: suspended }, borrowerId, false],
      [{ owner: null }, borrowerId, false],
    ];
    for (const [options, viewerId, viewable] of cases) {
      const { id } = await fixture(options);
      expect((await view(viewerId, id))?.item.viewable).toBe(viewable);
    }
  });

  test("a deleted owner or borrower reads Former member with a null id", async () => {
    const noOwner = await fixture({ owner: null });
    expect((await view(borrowerId, noOwner.id))?.owner).toEqual({
      id: null,
      displayName: people.formerMember,
    });
    const noBorrower = await fixture({ borrower: null });
    expect((await view(ownerId, noBorrower.id))?.borrower).toEqual({
      id: null,
      displayName: people.formerMember,
    });
  });

  test("closedByName names the closing organizer", async () => {
    const { id } = await fixture({
      status: "returned",
      startDate: "2030-06-01",
      endDate: "2030-06-05",
      extra: { closedById: organizerId, endedBy: "organizer" },
    });
    expect((await view(ownerId, id))?.closedByName).toBe("Ivo K.");
  });
});

describe("getLoanForViewer — the wire", () => {
  test("only the DTO's keys cross: no email, seen-at, changedAt or closedById", async () => {
    const { id, itemId } = await fixture({
      status: "approved",
      extra: { requestMessage: "Saturday morning?" },
    });
    const loan = (await view(ownerId, id)) as LoanDetailDTO;
    expect(Object.keys(loan).sort()).toEqual(
      [
        "id",
        "status",
        "startDate",
        "endDate",
        "lengthDays",
        "item",
        "owner",
        "borrower",
        "viewerRole",
        "requestMessage",
        "statusReason",
        "endedBy",
        "systemReason",
        "returnedOn",
        "returnedAsLent",
        "closedByName",
        "overlappingRequestCount",
        "contact",
        "actions",
      ].sort(),
    );
    expect(loan).toMatchObject({
      startDate: "2030-06-20",
      endDate: "2030-06-22",
      lengthDays: 3,
      item: { id: itemId, status: "listed", viewable: true },
      owner: { id: ownerId, displayName: "Olga M." },
      borrower: { id: borrowerId, displayName: "Ana P." },
      requestMessage: "Saturday morning?",
      actions: [],
    });
    expect(Object.keys(loan.item).sort()).toEqual(
      ["id", "title", "photo", "status", "viewable"].sort(),
    );
    expect(JSON.stringify(loan)).not.toMatch(
      /email|SeenAt|changedAt|closedById|@test\.invalid/,
    );
  });
});
