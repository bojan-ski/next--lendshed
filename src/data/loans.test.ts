import { holdRow } from "@/__tests__/support/hold-row";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { updateOwnContactDetails } from "@/data/account";
import { fromDbDate } from "@/data/db-dates";
import { hideOwnItem } from "@/data/items";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import { effectiveStatus } from "@/lib/dates/effective-status";
import type { OrganizerCloseInput } from "@/lib/schemas/loans";
import { people } from "@/strings/people";
import type { EffectiveLoanStatus, LoanDetailDTO } from "@/types/loan";
import { getItemForViewer } from "./browse";
import {
  closeLoanByOrganizer,
  getLoanForViewer,
  insertLoanRequest,
  markLoanBack,
  storeExpiredLoans,
  storeLapsedLoans,
} from "./loans";

vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

vi.mock("@/db", async (importOriginal) =>
  (await import("@/__tests__/support/snapshot")).snapshotDbModule(
    await importOriginal<typeof import("@/db")>(),
  ),
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

// The item page's request card (requestBlock) offers the form exactly when
// insertLoanRequest would create the loan, and names the refusal it would give.
describe("requestBlock ⇔ insertLoanRequest", () => {
  const OUTCOME = {
    null: "created",
    contact_details: "needsContactDetails",
    item_limit: "itemLimit",
    overall_limit: "overallLimit",
  } as const;

  const openOn = (itemId: string, borrowerId: string, from = "2030-06-25") =>
    scope.createLoan({
      itemId,
      borrowerId,
      status: "requested",
      startDate: from,
      endDate: from,
    });

  const openElsewhere = async (me: string, count: number) => {
    for (let index = 0; index < count; index += 1) {
      await openOn(await listed(), me);
    }
  };

  test.each<
    [
      string,
      keyof typeof OUTCOME,
      (me: string, itemId: string) => Promise<unknown>,
    ]
  >([
    ["nothing in the way", "null", async () => {}],
    [
      "no contact details",
      "contact_details",
      (me) =>
        db.user.update({ where: { id: me }, data: { contactDetails: null } }),
    ],
    [
      "an open request on the item",
      "item_limit",
      (me, itemId) => openOn(itemId, me),
    ],
    [
      "an expired request on the item",
      "null",
      (me, itemId) => openOn(itemId, me, "2030-06-14"),
    ],
    [
      "five open requests elsewhere",
      "overall_limit",
      (me) => openElsewhere(me, 5),
    ],
    [
      "four open and one expired elsewhere",
      "null",
      async (me) => {
        await openElsewhere(me, 4);
        await openOn(await listed(), me, "2030-06-14");
      },
    ],
  ])(
    "%s: the card shows %s and the insert agrees",
    async (_, expected, arrange) => {
      const me = await user({ contactDetails: "Call 555" });
      const itemId = await listed();
      await arrange(me, itemId);

      const block = (await getItemForViewer(as(me), itemId, TODAY))
        ?.requestBlock;
      expect(String(block)).toBe(expected);
      const { kind } = await request(me, itemId);
      expect(kind).toBe(OUTCOME[expected]);
    },
  );
});

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

  test("an organizer who is the borrower sees the owner's, as a party", async () => {
    const { id } = await fixture({ status: "approved", borrower: organizerId });
    expect((await view(organizerId, id, "organizer"))?.contact).toEqual(owners);
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

  test("a deleted owner or borrower reads Former member", async () => {
    const noOwner = await fixture({ owner: null });
    expect((await view(borrowerId, noOwner.id))?.owner).toEqual({
      displayName: people.formerMember,
    });
    const noBorrower = await fixture({ borrower: null });
    expect((await view(ownerId, noBorrower.id))?.borrower).toEqual({
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
        "handOverBlocked",
        "contact",
        "actions",
      ].sort(),
    );
    expect(loan).toMatchObject({
      startDate: "2030-06-20",
      endDate: "2030-06-22",
      lengthDays: 3,
      item: { id: itemId, status: "listed", viewable: true },
      owner: { displayName: "Olga M." },
      borrower: { displayName: "Ana P." },
      requestMessage: "Saturday morning?",
      actions: ["cancel"],
    });
    expect(Object.keys(loan.item).sort()).toEqual(
      ["id", "title", "photo", "status", "viewable"].sort(),
    );
    // No party id: the page links neither party (spec 17a).
    expect(Object.keys(loan.owner)).toEqual(["displayName"]);
    expect(Object.keys(loan.borrower)).toEqual(["displayName"]);
    expect(JSON.stringify(loan)).not.toMatch(
      /email|SeenAt|changedAt|closedById|@test\.invalid/,
    );
  });
});

// Spec 19: an organizer who isn't a party closes an out or overdue loan
// (OQ-22). Every fixture starts "seen and changed" long ago, so a write shows.
const OLD = new Date("2030-01-01T00:00:00Z");
const SEEN = { changedAt: OLD, ownerSeenAt: OLD, borrowerSeenAt: OLD };
const NOTE = "The owner can't be reached.";

// TODAY is 2030-06-15.
const DATES = {
  requested: {
    status: "requested",
    startDate: "2030-06-20",
    endDate: "2030-06-22",
  },
  approved: {
    status: "approved",
    startDate: "2030-06-20",
    endDate: "2030-06-22",
  },
  out: { status: "out", startDate: "2030-06-12", endDate: "2030-06-17" },
  overdue: { status: "out", startDate: "2030-06-10", endDate: "2030-06-12" },
  returned: {
    status: "returned",
    startDate: "2030-06-01",
    endDate: "2030-06-05",
    returnedOn: "2030-06-05",
  },
  declined: {
    status: "declined",
    startDate: "2030-06-20",
    endDate: "2030-06-22",
  },
  cancelled: {
    status: "cancelled",
    startDate: "2030-06-20",
    endDate: "2030-06-22",
  },
  expired: {
    status: "requested",
    startDate: "2030-06-10",
    endDate: "2030-06-12",
  },
  lapsed: {
    status: "approved",
    startDate: "2030-06-10",
    endDate: "2030-06-12",
  },
} as const satisfies Record<EffectiveLoanStatus, Fixture>;

const closeAs = (
  actorId: string,
  id: string,
  input: Partial<Omit<OrganizerCloseInput, "id">> = {},
) =>
  closeLoanByOrganizer(
    actorId,
    { id, returnedOn: TODAY, asLent: "yes", note: NOTE, ...input },
    TODAY,
  );

describe("closeLoanByOrganizer", () => {
  test.each([
    ["out", "yes"],
    ["out", "no"],
    ["out", "unknown"],
    ["overdue", "yes"],
    ["overdue", "no"],
    ["overdue", "unknown"],
  ] as const)(
    "a non-party organizer on an %s loan, as lent %s → returned; no seen-at moves",
    async (status, asLent) => {
      const { id } = await fixture({ ...DATES[status], extra: SEEN });
      const before = Date.now();

      expect(
        await closeAs(organizerId, id, { asLent, returnedOn: "2030-06-13" }),
      ).toBe("closed");

      const after = await loanRow(id);
      expect(after).toMatchObject({
        status: "returned",
        returnedAsLent: asLent,
        statusReason: NOTE,
        closedById: organizerId,
        endedBy: null,
        systemReason: null,
        ownerSeenAt: OLD,
        borrowerSeenAt: OLD,
      });
      expect(fromDbDate(after.returnedOn)).toBe("2030-06-13");
      expect(after.changedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    },
  );

  test("both parties see the change: the close reads Returned, closed by the organizer", async () => {
    const { id } = await fixture({ ...DATES.overdue, extra: SEEN });
    expect(await closeAs(organizerId, id, { asLent: "unknown" })).toBe(
      "closed",
    );
    for (const party of [ownerId, borrowerId]) {
      expect(await view(party, id)).toMatchObject({
        status: "returned",
        returnedOn: TODAY,
        returnedAsLent: "unknown",
        closedByName: "Ivo K.",
        statusReason: NOTE,
        endedBy: null,
      });
    }
  });

  test.each([
    "requested",
    "approved",
    "returned",
    "declined",
    "cancelled",
    "expired",
    "lapsed",
  ] as const)("a %s loan → stale, nothing written", async (status) => {
    const { id } = await fixture({ ...DATES[status], extra: SEEN });
    const before = await loanRow(id);
    expect(await closeAs(organizerId, id, { returnedOn: "2030-06-10" })).toBe(
      "stale",
    );
    expect(await loanRow(id)).toEqual(before);
  });

  test("the owner or the borrower closing as an organizer → stale, nothing written (OQ-19)", async () => {
    const owned = await fixture({
      ...DATES.out,
      owner: organizerId,
      extra: SEEN,
    });
    const borrowed = await fixture({
      ...DATES.out,
      borrower: organizerId,
      extra: SEEN,
    });
    for (const { id } of [owned, borrowed]) {
      const before = await loanRow(id);
      expect(await closeAs(organizerId, id)).toBe("stale");
      expect(await loanRow(id)).toEqual(before);
    }
  });

  test("a member, a demoted or a suspended organizer → stale, nothing written", async () => {
    const demoted = await user({ role: "organizer" });
    await db.user.update({ where: { id: demoted }, data: { role: "member" } });
    const suspended = await user({ role: "organizer", status: "suspended" });
    const { id } = await fixture({ ...DATES.out, extra: SEEN });
    const before = await loanRow(id);

    for (const actor of [strangerId, demoted, suspended]) {
      expect(await closeAs(actor, id)).toBe("stale");
    }
    expect(await loanRow(id)).toEqual(before);
  });

  test("an unknown id → stale", async () => {
    expect(await closeAs(organizerId, crypto.randomUUID())).toBe("stale");
  });

  test("a return date the day before the start → beforeStart, nothing written; the start itself closes", async () => {
    const { id } = await fixture({ ...DATES.overdue, extra: SEEN });
    const before = await loanRow(id);

    expect(await closeAs(organizerId, id, { returnedOn: "2030-06-09" })).toBe(
      "beforeStart",
    );
    expect(await loanRow(id)).toEqual(before);
    expect(await closeAs(organizerId, id, { returnedOn: "2030-06-10" })).toBe(
      "closed",
    );
  });
});

describe("getLoanForViewer — the organizer close", () => {
  test.each(Object.keys(DATES) as EffectiveLoanStatus[])(
    "a non-party organizer on a %s loan gets exactly what the close accepts",
    async (status) => {
      const { id } = await fixture(DATES[status]);
      const dto = await view(organizerId, id, "organizer");
      expect(dto?.status).toBe(status);
      expect(dto?.actions).toEqual(
        status === "out" || status === "overdue" ? ["organizer_close"] : [],
      );
    },
  );

  test("an organizer who is a party keeps the party's controls, never the close", async () => {
    for (const status of ["out", "overdue"] as const) {
      const owned = await fixture({ ...DATES[status], owner: organizerId });
      const borrowed = await fixture({
        ...DATES[status],
        borrower: organizerId,
      });
      expect((await view(organizerId, owned.id, "organizer"))?.actions).toEqual(
        ["mark_returned"],
      );
      expect(
        (await view(organizerId, borrowed.id, "organizer"))?.actions,
      ).toEqual([]);
    }
  });
});

// Both contenders queue behind a held item row, so they really overlap.
describe("closeLoanByOrganizer vs markLoanBack (held item row)", () => {
  const giveBack = (id: string) =>
    markLoanBack(ownerId, { id, returnedOn: TODAY, asLent: "yes" }, TODAY);

  test.each(["the close", "the owner's return"] as const)(
    "%s queued first wins; the other is stale",
    async (first) => {
      const { id, itemId } = await fixture({ ...DATES.overdue, extra: SEEN });
      const hold = holdRow("item", itemId);
      await hold.held;

      const closeFirst = first === "the close";
      const a = closeFirst ? closeAs(organizerId, id) : giveBack(id);
      await hold.queued(1);
      const b = closeFirst ? giveBack(id) : closeAs(organizerId, id);
      await hold.queued(2);
      hold.release();
      const [won, lost] = await Promise.all([a, b, hold.done]);

      expect(won).toBe(closeFirst ? "closed" : "returned");
      expect(lost).toBe("stale");
      const after = await loanRow(id);
      expect(after.status).toBe("returned");
      expect(after.closedById).toBe(closeFirst ? organizerId : null);
      expect(after.statusReason).toBe(closeFirst ? NOTE : null);
    },
  );
});

// The daily job's tidy (spec 22) writes app-wide, so it runs in one rolled-back
// snapshot on a 2001 `today`: only this test's rows are that old, and they are
// created inside the snapshot.
describe("storeExpiredLoans / storeLapsedLoans", () => {
  const JOB_TODAY = "2001-03-10";
  const SEEN = new Date("2001-03-01T08:00:00.000Z");
  const CHANGED = new Date("2001-03-02T08:00:00.000Z");
  const columns = {
    id: true,
    status: true,
    startDate: true,
    endDate: true,
    changedAt: true,
    ownerSeenAt: true,
    borrowerSeenAt: true,
    endedBy: true,
    systemReason: true,
    statusReason: true,
    returnedOn: true,
    itemId: true,
    borrowerId: true,
  } as const;

  // Items (and the scope's lazily created category) are committed outside the
  // snapshot: one created inside would vanish with its rollback.
  const items: string[] = [];
  beforeAll(async () => {
    items.push(...(await Promise.all([1, 2, 3, 4, 5].map(() => listed()))));
  });

  let next = 0;
  async function loan(status: LoanStatus, startDate: string, endDate: string) {
    const { id } = await scope.createLoan({
      itemId: items[next++ % items.length],
      borrowerId,
      status,
      startDate,
      endDate,
      changedAt: CHANGED,
      ownerSeenAt: SEEN,
      borrowerSeenAt: SEEN,
      statusReason: "a note",
    });
    return id;
  }

  const read = (ids: string[]) =>
    db.loan.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
      select: columns,
    });

  const effectiveOf = (row: {
    status: LoanStatus;
    startDate: Date;
    endDate: Date;
  }) =>
    effectiveStatus(
      {
        status: row.status,
        startDate: fromDbDate(row.startDate),
        endDate: fromDbDate(row.endDate),
      },
      JOB_TODAY,
    );

  test("stores expired / lapsed on past rows only, writing status alone", async () => {
    const outcome = await inOneSnapshot(async () => {
      const ids = {
        startedRequest: await loan("requested", "2001-03-09", "2001-03-12"),
        todayRequest: await loan("requested", JOB_TODAY, "2001-03-12"),
        endedApproval: await loan("approved", "2001-03-05", "2001-03-09"),
        todayApproval: await loan("approved", "2001-03-05", JOB_TODAY),
        overdue: await loan("out", "2001-03-01", "2001-03-05"),
      };
      const all = Object.values(ids);
      const before = await read(all);
      const expired = await storeExpiredLoans(JOB_TODAY);
      const lapsed = await storeLapsedLoans(JOB_TODAY);
      const after = await read(all);
      return { ids, before, after, expired, lapsed };
    });

    expect(outcome.expired).toBe(1);
    expect(outcome.lapsed).toBe(1);
    const statusOf = (id: string) =>
      outcome.after.find((row) => row.id === id)!.status;
    expect(statusOf(outcome.ids.startedRequest)).toBe("expired");
    expect(statusOf(outcome.ids.todayRequest)).toBe("requested");
    expect(statusOf(outcome.ids.endedApproval)).toBe("lapsed");
    expect(statusOf(outcome.ids.todayApproval)).toBe("approved");
    expect(statusOf(outcome.ids.overdue)).toBe("out");

    // Every other column byte-identical; no row's effective status moves.
    const withoutStatus = (row: object) =>
      Object.fromEntries(
        Object.entries(row).filter(([column]) => column !== "status"),
      );
    expect(outcome.after.map(withoutStatus)).toEqual(
      outcome.before.map(withoutStatus),
    );
    expect(outcome.after.map(effectiveOf)).toEqual(
      outcome.before.map(effectiveOf),
    );
  });

  test("a second tidy for the same today finds nothing", async () => {
    const counts = await inOneSnapshot(async () => {
      await loan("requested", "2001-03-01", "2001-03-03");
      await loan("approved", "2001-03-01", "2001-03-03");
      const first = [
        await storeExpiredLoans(JOB_TODAY),
        await storeLapsedLoans(JOB_TODAY),
      ];
      const second = [
        await storeExpiredLoans(JOB_TODAY),
        await storeLapsedLoans(JOB_TODAY),
      ];
      return { first, second };
    });
    expect(counts).toEqual({ first: [1, 1], second: [0, 0] });
  });
});
