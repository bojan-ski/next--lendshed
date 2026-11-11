import { storedFileSize } from "@/__tests__/support/photo-storage";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { updateOwnContactDetails } from "@/data/account";
import { isCategoryReferenced, isItemReferencedByLoan } from "@/data/db-errors";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import type { ItemDetailsInput } from "@/lib/schemas/items";
import { people } from "@/strings/people";
import type { OwnItemRowDTO } from "@/types/item";
import {
  countActiveOwnItems,
  deleteOwnItem,
  getItemForEdit,
  getOwnItems,
  hideOwnItem,
  insertItem,
  listOwnItem,
  retireItemByOwner,
  updateOwnItem,
} from "./items";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const TODAY = "2030-06-15";
let borrowerId: string;

beforeAll(async () => {
  await assertMigrated();
  borrowerId = (await scope.createTestUser({ name: "Ana P." })).id;
});
afterAll(() => scope.cleanup());

const owner = async (contactDetails: string | null = null) =>
  (await scope.createTestUser({ contactDetails })).id;

const loanOn = (
  itemId: string,
  status: LoanStatus,
  startDate: string,
  endDate: string,
  extra: { borrowerId?: string | null; createdAt?: Date } = {},
) =>
  scope.createLoan({
    itemId,
    borrowerId: extra.borrowerId === undefined ? borrowerId : extra.borrowerId,
    status,
    startDate,
    endDate,
    ...(extra.createdAt && { createdAt: extra.createdAt }),
  });

const at = (iso: string) => new Date(`${iso}T12:00:00Z`);

describe("getOwnItems", () => {
  test("lists only the owner's items: non-retired newest first, then retired by retiredAt", async () => {
    const ownerId = await owner();
    const older = await scope.createItem({
      ownerId,
      createdAt: at("2030-01-01"),
    });
    const newer = await scope.createItem({
      ownerId,
      status: "listed",
      createdAt: at("2030-02-01"),
    });
    const retiredEarly = await scope.createItem({
      ownerId,
      status: "retired",
      createdAt: at("2030-03-01"),
      retiredAt: at("2030-03-05"),
    });
    const retiredLate = await scope.createItem({
      ownerId,
      status: "retired",
      createdAt: at("2029-12-01"),
      retiredAt: at("2030-04-01"),
    });
    await scope.createItem({ ownerId: await owner() });

    const result = await getOwnItems(ownerId, TODAY);

    expect(result.rows.map((row) => row.id)).toEqual([
      newer.id,
      older.id,
      retiredLate.id,
      retiredEarly.id,
    ]);
    expect(result.activeCount).toBe(2);
    expect(result.cap).toBe(30);
  });

  test("an owner with no items gets an empty list", async () => {
    expect(await getOwnItems(await owner(), TODAY)).toEqual({
      rows: [],
      activeCount: 0,
      cap: 30,
    });
  });

  test("a row carries exactly id, title, status, photo and now", async () => {
    const ownerId = await owner();
    await scope.createItem({ ownerId, title: "Drill", photo: true });
    const [row] = (await getOwnItems(ownerId, TODAY)).rows;
    expect(Object.keys(row).sort()).toEqual([
      "id",
      "now",
      "photo",
      "status",
      "title",
    ]);
    expect(row.title).toBe("Drill");
    expect(row.photo).toEqual({
      url: expect.any(String),
      width: 1200,
      height: 900,
    });
  });

  describe("the Now line, first match wins", () => {
    let ownerId: string;
    let rows: Map<string, OwnItemRowDTO>;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      ownerId = await owner();
      const item = async (
        key: string,
        status: "hidden" | "listed" | "retired",
      ) => {
        ids[key] = (await scope.createItem({ ownerId, status })).id;
        return ids[key];
      };

      // 1: retired
      await item("retired", "retired");
      // 2–4: an out loan by its end date, before hidden
      await loanOn(
        await item("overdue", "listed"),
        "out",
        "2030-06-01",
        "2030-06-14",
      );
      await loanOn(
        await item("backToday", "listed"),
        "out",
        "2030-06-10",
        "2030-06-15",
      );
      await loanOn(
        await item("withHidden", "hidden"),
        "out",
        "2030-06-14",
        "2030-06-20",
      );
      await loanOn(
        await item("formerMember", "listed"),
        "out",
        "2030-06-14",
        "2030-06-20",
        {
          borrowerId: null,
        },
      );
      const outAndOpen = await item("outBeatsOpen", "listed");
      await loanOn(outAndOpen, "out", "2030-06-14", "2030-06-16");
      await loanOn(outAndOpen, "requested", "2030-06-20", "2030-06-22");
      // 5: hidden, even with an open request
      await item("hidden", "hidden");
      await loanOn(
        await item("hiddenOpen", "hidden"),
        "requested",
        "2030-06-20",
        "2030-06-21",
      );
      // 6: the earliest-created open request names its borrower
      const requested = await item("requestedBy", "listed");
      const later = await scope.createTestUser({ name: "Tom B." });
      await loanOn(requested, "requested", "2030-06-16", "2030-06-17", {
        borrowerId: later.id,
        createdAt: at("2030-06-12"),
      });
      await loanOn(requested, "requested", "2030-06-20", "2030-06-21", {
        createdAt: at("2030-06-11"),
      });
      // 7: idle, including an expired request and an approval not yet handed over
      await item("idle", "listed");
      await loanOn(
        await item("expired", "listed"),
        "requested",
        "2030-06-14",
        "2030-06-16",
      );
      await loanOn(
        await item("approved", "listed"),
        "approved",
        "2030-06-16",
        "2030-06-18",
      );
      await loanOn(
        await item("returned", "listed"),
        "returned",
        "2030-06-01",
        "2030-06-05",
      );

      rows = new Map(
        (await getOwnItems(ownerId, TODAY)).rows.map((row) => [row.id, row]),
      );
    });

    test.each([
      ["retired", "retired", null],
      ["overdue", "overdue", "Ana P."],
      ["backToday", "back_today", "Ana P."],
      ["withHidden", "with", "Ana P."],
      ["formerMember", "with", people.formerMember],
      ["outBeatsOpen", "with", "Ana P."],
      ["hidden", "hidden", null],
      ["hiddenOpen", "hidden", null],
      ["requestedBy", "requested_by", "Ana P."],
      ["idle", "idle", null],
      ["expired", "idle", null],
      ["approved", "idle", null],
      ["returned", "idle", null],
    ])("%s → %s", (key, kind, personName) => {
      expect(rows.get(ids[key])?.now).toEqual({ kind, personName });
    });
  });
});

describe("getItemForEdit", () => {
  const EDIT_KEYS = [
    "categoryId",
    "condition",
    "description",
    "hasAnyLoan",
    "hasBlockingLoan",
    "id",
    "maxLoanDays",
    "ownerHasContactDetails",
    "photo",
    "pickupNotes",
    "retiredNote",
    "status",
    "title",
  ];

  test("returns the owner's item with exactly the ItemEditDTO fields", async () => {
    const ownerId = await owner("Phone 555");
    const { id } = await scope.createItem({
      ownerId,
      title: "Tent",
      maxLoanDays: 10,
    });

    const dto = await getItemForEdit(ownerId, id, TODAY);

    expect(Object.keys(dto ?? {}).sort()).toEqual(EDIT_KEYS);
    expect(dto).toMatchObject({
      id,
      title: "Tent",
      description: "",
      condition: "good",
      maxLoanDays: 10,
      pickupNotes: null,
      status: "hidden",
      photo: null,
      retiredNote: null,
      hasAnyLoan: false,
      hasBlockingLoan: false,
      ownerHasContactDetails: true,
    });
    expect(JSON.stringify(dto)).not.toContain(ownerId);
  });

  test("is null for another member's item, an ownerless item and an unknown id", async () => {
    const ownerId = await owner();
    const other = await scope.createItem({ ownerId: await owner() });
    const ownerless = await scope.createItem({ ownerId: null });

    expect(await getItemForEdit(ownerId, other.id, TODAY)).toBeNull();
    expect(await getItemForEdit(ownerId, ownerless.id, TODAY)).toBeNull();
    expect(
      await getItemForEdit(ownerId, crypto.randomUUID(), TODAY),
    ).toBeNull();
    expect(await getItemForEdit(ownerId, "not-a-uuid", TODAY)).toBeNull();
  });

  test("a retired item is returned, with its note", async () => {
    const ownerId = await owner();
    const { id } = await scope.createItem({ ownerId, status: "retired" });
    await db.item.update({ where: { id }, data: { retiredNote: "Broken" } });

    expect(await getItemForEdit(ownerId, id, TODAY)).toMatchObject({
      status: "retired",
      retiredNote: "Broken",
    });
  });

  test.each([
    ["no loan", null, false, false],
    [
      "a declined request",
      ["declined", "2030-06-16", "2030-06-17"],
      true,
      false,
    ],
    ["an open request", ["requested", "2030-06-16", "2030-06-17"], true, false],
    [
      "a lapsed approval",
      ["approved", "2030-06-10", "2030-06-14"],
      true,
      false,
    ],
    ["a future approval", ["approved", "2030-06-16", "2030-06-17"], true, true],
    ["an out loan", ["out", "2030-06-14", "2030-06-16"], true, true],
    ["an overdue out loan", ["out", "2030-06-01", "2030-06-10"], true, true],
  ] as const)(
    "%s: hasAnyLoan %s, hasBlockingLoan %s",
    async (_label, loan, any, blocking) => {
      const ownerId = await owner();
      const { id } = await scope.createItem({ ownerId });
      if (loan) await loanOn(id, loan[0], loan[1], loan[2]);

      expect(await getItemForEdit(ownerId, id, TODAY)).toMatchObject({
        hasAnyLoan: any,
        hasBlockingLoan: blocking,
      });
    },
  );

  test("ownerHasContactDetails is false without saved details", async () => {
    const ownerId = await owner(null);
    const { id } = await scope.createItem({ ownerId });
    expect(
      (await getItemForEdit(ownerId, id, TODAY))?.ownerHasContactDetails,
    ).toBe(false);
  });
});

const itemRow = (id: string) => db.item.findUnique({ where: { id } });
const loanRow = (id: string) => db.loan.findUniqueOrThrow({ where: { id } });

// Category names are unique within the scope.
let categoryCount = 0;
const newCategory = async () =>
  (await scope.createCategory(`Kind ${++categoryCount}`)).id;

async function details(
  overrides: Partial<ItemDetailsInput> = {},
): Promise<ItemDetailsInput> {
  return {
    title: "Hedge trimmer",
    description: "Cordless, two batteries",
    categoryId: await newCategory(),
    condition: "worn",
    maxLoanDays: 4,
    pickupNotes: "Ring twice",
    ...overrides,
  };
}

// Many items for one owner in one statement; cleanup finds them by owner.
async function fill(ownerId: string, count: number, status: ItemStatus) {
  const categoryId = await newCategory();
  await db.item.createMany({
    data: Array.from({ length: count }, (_, n) => ({
      ownerId,
      categoryId,
      title: `Item ${n}`,
      description: "",
      condition: "good" as const,
      status,
      retiredAt: status === "retired" ? new Date() : null,
    })),
  });
}

// Holds a row so the transactions started meanwhile queue behind it.
function holdRow(table: "item" | "user", id: string) {
  let rowHeld!: () => void;
  const held = new Promise<void>((resolve) => (rowHeld = resolve));
  const done = db.$transaction(
    async (tx) => {
      if (table === "item") {
        await tx.$queryRaw`SELECT id FROM item WHERE id = ${id} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${id} FOR UPDATE`;
      }
      rowHeld();
      await tx.$executeRaw`SELECT pg_sleep(2)`;
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
  return { held, done };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("countActiveOwnItems", () => {
  test("counts the owner's hidden and listed items, never retired or others'", async () => {
    const ownerId = await owner();
    await scope.createItem({ ownerId });
    await scope.createItem({ ownerId, status: "listed" });
    await scope.createItem({ ownerId, status: "retired" });
    await scope.createItem({ ownerId: await owner() });

    expect(await countActiveOwnItems(ownerId)).toBe(2);
  });
});

describe("insertItem", () => {
  test("creates a Hidden item owned by the caller, with no photo, listedAt or retirement", async () => {
    const ownerId = await owner();
    const input = await details();

    const outcome = await insertItem(ownerId, input);

    expect(outcome.kind).toBe("created");
    const row = await itemRow(outcome.kind === "created" ? outcome.id : "");
    expect(row).toMatchObject({
      ...input,
      ownerId,
      status: "hidden",
      listedAt: null,
      retiredAt: null,
      retiredNote: null,
      retiredById: null,
      photoKey: null,
      photoUrl: null,
    });
  });

  test.each([
    ["29 active", 29, 0, "created"],
    ["30 active", 30, 0, "capReached"],
    ["29 active and 1 retired", 29, 1, "created"],
  ] as const)("%s → %s", async (_label, active, retired, kind) => {
    const ownerId = await owner();
    await fill(ownerId, active, "hidden");
    if (retired) await fill(ownerId, retired, "retired");

    expect((await insertItem(ownerId, await details())).kind).toBe(kind);
    expect(await db.item.count({ where: { ownerId } })).toBe(
      active + retired + (kind === "created" ? 1 : 0),
    );
  });

  test("a category that no longer exists → categoryMissing, nothing written", async () => {
    const ownerId = await owner();

    expect(
      await insertItem(
        ownerId,
        await details({ categoryId: crypto.randomUUID() }),
      ),
    ).toEqual({ kind: "categoryMissing" });
    expect(await db.item.count({ where: { ownerId } })).toBe(0);
  });
});

describe("updateOwnItem", () => {
  test.each(["hidden", "listed"] as const)(
    "saves the six fields of a %s item and keeps its status and listedAt",
    async (status) => {
      const ownerId = await owner();
      const { id } = await scope.createItem({ ownerId, status });
      const before = await itemRow(id);
      const input = await details();

      expect(await updateOwnItem(ownerId, id, input)).toBe("saved");
      expect(await itemRow(id)).toMatchObject({
        ...input,
        status,
        listedAt: before?.listedAt,
      });
    },
  );

  test("a retired, someone else's, ownerless or unknown item is stale and unchanged", async () => {
    const ownerId = await owner();
    const retired = await scope.createItem({ ownerId, status: "retired" });
    const others = await scope.createItem({ ownerId: await owner() });
    const ownerless = await scope.createItem({ ownerId: null });
    const input = await details();

    for (const id of [retired.id, others.id, ownerless.id]) {
      const before = await itemRow(id);
      expect(await updateOwnItem(ownerId, id, input)).toBe("stale");
      expect(await itemRow(id)).toEqual(before);
    }
    expect(await updateOwnItem(ownerId, crypto.randomUUID(), input)).toBe(
      "stale",
    );
  });

  test("a category that no longer exists → categoryMissing, nothing written", async () => {
    const ownerId = await owner();
    const { id } = await scope.createItem({ ownerId });
    const before = await itemRow(id);

    expect(
      await updateOwnItem(
        ownerId,
        id,
        await details({ categoryId: crypto.randomUUID() }),
      ),
    ).toBe("categoryMissing");
    expect(await itemRow(id)).toEqual(before);
  });
});

describe("listOwnItem", () => {
  test("a hidden item with a photo and saved contact details is listed now", async () => {
    const ownerId = await owner("Phone 555");
    const { id } = await scope.createItem({ ownerId, photo: true });
    const before = Date.now();

    expect(await listOwnItem(ownerId, id)).toBe("listed");
    const row = await itemRow(id);
    expect(row?.status).toBe("listed");
    expect(row?.listedAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test("no photo → needsPhoto, checked before the contact details", async () => {
    const ownerId = await owner(null);
    const { id } = await scope.createItem({ ownerId });

    expect(await listOwnItem(ownerId, id)).toBe("needsPhoto");
    expect((await itemRow(id))?.status).toBe("hidden");
  });

  test("a photo but no contact details → needsContactDetails", async () => {
    const ownerId = await owner(null);
    const { id } = await scope.createItem({ ownerId, photo: true });

    expect(await listOwnItem(ownerId, id)).toBe("needsContactDetails");
    expect((await itemRow(id))?.status).toBe("hidden");
  });

  test("already listed, retired, someone else's or unknown → stale", async () => {
    const ownerId = await owner("Phone 555");
    const listed = await scope.createItem({
      ownerId,
      status: "listed",
      photo: true,
    });
    const retired = await scope.createItem({ ownerId, status: "retired" });
    const others = await scope.createItem({
      ownerId: await owner("Phone 556"),
      photo: true,
    });

    for (const id of [listed.id, retired.id, others.id, crypto.randomUUID()]) {
      expect(await listOwnItem(ownerId, id)).toBe("stale");
    }
    expect((await itemRow(others.id))?.status).toBe("hidden");
  });

  // The list takes the owner's row FOR SHARE before it waits on the held item,
  // so the clear (FOR UPDATE on that row) can only run after the list commits.
  test("a list holding the owner's row → the concurrent clear is refused locked", async () => {
    const ownerId = await owner("Phone 555");
    const { id } = await scope.createItem({ ownerId, photo: true });
    const hold = holdRow("item", id);
    await hold.held;

    const list = listOwnItem(ownerId, id);
    await pause(500);
    const clear = updateOwnContactDetails(ownerId, null, TODAY);
    const [listed, cleared] = await Promise.all([list, clear, hold.done]);

    expect([listed, cleared]).toEqual(["listed", "locked"]);
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: ownerId } }))
        .contactDetails,
    ).toBe("Phone 555");
  });

  test("a clear queued first → the list is refused needsContactDetails", async () => {
    const ownerId = await owner("Phone 555");
    const { id } = await scope.createItem({ ownerId, photo: true });
    const hold = holdRow("user", ownerId);
    await hold.held;

    const clear = updateOwnContactDetails(ownerId, null, TODAY);
    await pause(500);
    const list = listOwnItem(ownerId, id);
    const [cleared, listed] = await Promise.all([clear, list, hold.done]);

    expect([cleared, listed]).toEqual(["saved", "needsContactDetails"]);
    expect((await itemRow(id))?.status).toBe("hidden");
  });
});

// TODAY is 2030-06-15. Approved and out rows on one item never overlap (the
// exclusion constraint), so each gets its own range.
async function itemWithEveryLoan(status: ItemStatus) {
  const ownerId = await owner("Phone 555");
  const { id } = await scope.createItem({ ownerId, status, photo: true });
  const seenBefore = at("2030-06-01");
  const open = await scope.createLoan({
    itemId: id,
    borrowerId,
    status: "requested",
    startDate: "2030-06-20",
    endDate: "2030-06-21",
    borrowerSeenAt: seenBefore,
  });
  const openToday = await loanOn(id, "requested", TODAY, "2030-06-16");
  const expired = await loanOn(id, "requested", "2030-06-10", "2030-06-11");
  const approved = await loanOn(id, "approved", "2030-07-01", "2030-07-02");
  const out = await loanOn(id, "out", "2030-06-14", "2030-06-16");
  const other = await scope.createItem({ ownerId });
  const otherOpen = await loanOn(
    other.id,
    "requested",
    "2030-06-20",
    "2030-06-21",
  );
  return {
    ownerId,
    id,
    open,
    openToday,
    expired,
    approved,
    out,
    otherOpen,
    seenBefore,
  };
}

describe("hideOwnItem", () => {
  test("hides a listed item and keeps listedAt", async () => {
    const ownerId = await owner();
    const { id } = await scope.createItem({ ownerId, status: "listed" });
    const before = await itemRow(id);

    expect(await hideOwnItem(ownerId, id, TODAY)).toBe("hidden");
    expect(await itemRow(id)).toMatchObject({
      status: "hidden",
      listedAt: before?.listedAt,
    });
  });

  test("declines exactly the effective requests on the item, as the system", async () => {
    const fx = await itemWithEveryLoan("listed");
    const untouched = await Promise.all(
      [fx.expired, fx.approved, fx.out, fx.otherOpen].map(({ id }) =>
        loanRow(id),
      ),
    );
    const before = Date.now();

    expect(await hideOwnItem(fx.ownerId, fx.id, TODAY)).toBe("hidden");

    for (const loan of [fx.open, fx.openToday]) {
      const row = await loanRow(loan.id);
      expect(row).toMatchObject({
        status: "declined",
        endedBy: "system",
        systemReason: "item_hidden",
        statusReason: null,
      });
      expect(row.changedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(row.ownerSeenAt?.getTime()).toBe(row.changedAt.getTime());
    }
    expect((await loanRow(fx.open.id)).borrowerSeenAt).toEqual(fx.seenBefore);
    for (const row of untouched) expect(await loanRow(row.id)).toEqual(row);
  });

  test("hidden, retired, someone else's or unknown → stale", async () => {
    const ownerId = await owner();
    const hidden = await scope.createItem({ ownerId });
    const retired = await scope.createItem({ ownerId, status: "retired" });
    const others = await scope.createItem({
      ownerId: await owner(),
      status: "listed",
    });

    for (const id of [hidden.id, retired.id, others.id, crypto.randomUUID()]) {
      expect(await hideOwnItem(ownerId, id, TODAY)).toBe("stale");
    }
    expect((await itemRow(others.id))?.status).toBe("listed");
  });
});

describe("retireItemByOwner", () => {
  test.each([
    ["an approved loan", "approved", "2030-07-01", "2030-07-02"],
    ["an out loan", "out", "2030-06-14", "2030-06-16"],
    ["an overdue loan", "out", "2030-06-01", "2030-06-10"],
  ] as const)(
    "%s → blocked, nothing written",
    async (_label, status, start, end) => {
      const ownerId = await owner();
      const { id } = await scope.createItem({ ownerId, status: "listed" });
      const blocking = await loanOn(id, status, start, end);
      const open = await loanOn(id, "requested", "2030-08-01", "2030-08-02");
      const before = await itemRow(id);
      const loans = [await loanRow(blocking.id), await loanRow(open.id)];

      expect(await retireItemByOwner(ownerId, id, TODAY)).toBe("blocked");
      expect(await itemRow(id)).toEqual(before);
      for (const loan of loans) expect(await loanRow(loan.id)).toEqual(loan);
    },
  );

  test.each(["hidden", "listed"] as const)(
    "a %s item with a lapsed approval and past loans is retired; open requests declined",
    async (status) => {
      const ownerId = await owner();
      const { id } = await scope.createItem({ ownerId, status });
      await loanOn(id, "approved", "2030-06-10", "2030-06-14");
      await loanOn(id, "returned", "2030-05-01", "2030-05-02");
      const expired = await loanOn(id, "requested", "2030-06-10", "2030-06-11");
      const open = await loanOn(id, "requested", "2030-06-20", "2030-06-21");
      const expiredBefore = await loanRow(expired.id);

      expect(await retireItemByOwner(ownerId, id, TODAY)).toBe("retired");
      const row = await itemRow(id);
      expect(row).toMatchObject({
        status: "retired",
        retiredNote: null,
        retiredById: null,
      });
      expect(row?.retiredAt).toBeInstanceOf(Date);
      expect(await loanRow(open.id)).toMatchObject({
        status: "declined",
        endedBy: "system",
        systemReason: "item_retired",
      });
      expect(await loanRow(expired.id)).toEqual(expiredBefore);
    },
  );

  test("retired, someone else's or unknown → stale", async () => {
    const ownerId = await owner();
    const retired = await scope.createItem({ ownerId, status: "retired" });
    const others = await scope.createItem({ ownerId: await owner() });

    for (const id of [retired.id, others.id, crypto.randomUUID()]) {
      expect(await retireItemByOwner(ownerId, id, TODAY)).toBe("stale");
    }
    expect((await itemRow(others.id))?.status).toBe("hidden");
  });
});

describe("deleteOwnItem", () => {
  test.each(["hidden", "listed"] as const)(
    "a %s item with no loan rows is deleted",
    async (status) => {
      const ownerId = await owner();
      const { id } = await scope.createItem({ ownerId, status });

      expect(await deleteOwnItem(ownerId, id)).toBe("deleted");
      expect(await itemRow(id)).toBeNull();
    },
  );

  test.each(["declined", "cancelled", "returned", "requested"] as const)(
    "any loan row (%s) → hasLoans, row kept",
    async (status) => {
      const ownerId = await owner();
      const { id } = await scope.createItem({ ownerId });
      await loanOn(id, status, "2030-05-01", "2030-05-02");

      expect(await deleteOwnItem(ownerId, id)).toBe("hasLoans");
      expect(await itemRow(id)).not.toBeNull();
    },
  );

  test("retired, someone else's or unknown → stale, row kept", async () => {
    const ownerId = await owner();
    const retired = await scope.createItem({ ownerId, status: "retired" });
    const others = await scope.createItem({ ownerId: await owner() });

    for (const id of [retired.id, others.id, crypto.randomUUID()]) {
      expect(await deleteOwnItem(ownerId, id)).toBe("stale");
    }
    expect(await itemRow(retired.id)).not.toBeNull();
    expect(await itemRow(others.id)).not.toBeNull();
  });
});

// Real files through the disk driver: queued in the transaction, deleted after commit.
describe("the photo outbox on retire and delete", () => {
  const queueRow = (storageKey: string) =>
    db.pendingBlobDeletion.findUnique({ where: { storageKey } });

  test("retire nulls all five photo columns and deletes the file", async () => {
    const ownerId = await owner();
    const photo = await scope.createStoredPhoto();
    const { id } = await scope.createItem({ ownerId, status: "listed", photo });

    expect(await retireItemByOwner(ownerId, id, TODAY)).toBe("retired");

    expect(await itemRow(id)).toMatchObject({
      status: "retired",
      photoKey: null,
      photoUrl: null,
      photoWidth: null,
      photoHeight: null,
      photoBytes: null,
    });
    expect(await storedFileSize(photo.photoKey)).toBeNull();
    expect(await queueRow(photo.photoKey)).toBeNull();
  });

  test("a blocked retire keeps the photo and queues nothing", async () => {
    const ownerId = await owner();
    const photo = await scope.createStoredPhoto();
    const { id } = await scope.createItem({ ownerId, photo });
    await loanOn(id, "approved", "2030-07-01", "2030-07-02");

    expect(await retireItemByOwner(ownerId, id, TODAY)).toBe("blocked");

    expect((await itemRow(id))?.photoKey).toBe(photo.photoKey);
    expect(await storedFileSize(photo.photoKey)).toBe(photo.photoBytes);
    expect(await queueRow(photo.photoKey)).toBeNull();
  });

  test("delete removes the file with the row", async () => {
    const ownerId = await owner();
    const photo = await scope.createStoredPhoto();
    const { id } = await scope.createItem({ ownerId, photo });

    expect(await deleteOwnItem(ownerId, id)).toBe("deleted");

    expect(await itemRow(id)).toBeNull();
    expect(await storedFileSize(photo.photoKey)).toBeNull();
    expect(await queueRow(photo.photoKey)).toBeNull();
  });

  test("a hasLoans delete keeps the photo and queues nothing", async () => {
    const ownerId = await owner();
    const photo = await scope.createStoredPhoto();
    const { id } = await scope.createItem({ ownerId, photo });
    await loanOn(id, "returned", "2030-05-01", "2030-05-02");

    expect(await deleteOwnItem(ownerId, id)).toBe("hasLoans");

    expect(await storedFileSize(photo.photoKey)).toBe(photo.photoBytes);
    expect(await queueRow(photo.photoKey)).toBeNull();
  });
});

// The real errors the two mappings rely on, so each matches only its own FK.
describe("foreign-key errors under the pg adapter", () => {
  test("deleting an item with a loan is the loan FK, not the category FK", async () => {
    const { id } = await scope.createItem({ ownerId: await owner() });
    await loanOn(id, "declined", "2030-05-01", "2030-05-02");

    const error: unknown = await db.item
      .delete({ where: { id } })
      .catch((e: unknown) => e);

    expect(isItemReferencedByLoan(error)).toBe(true);
    expect(isCategoryReferenced(error)).toBe(false);
  });

  test("an item with a missing category is the category FK, not the loan FK", async () => {
    const error: unknown = await db.item
      .create({
        data: {
          ownerId: await owner(),
          categoryId: crypto.randomUUID(),
          title: "Saw",
          description: "",
          condition: "good",
        },
      })
      .catch((e: unknown) => e);

    expect(isCategoryReferenced(error)).toBe(true);
    expect(isItemReferencedByLoan(error)).toBe(false);
  });
});
