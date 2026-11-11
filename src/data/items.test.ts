import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import type { LoanStatus } from "@/generated/prisma/enums";
import { people } from "@/strings/people";
import type { OwnItemRowDTO } from "@/types/item";
import { getItemForEdit, getOwnItems } from "./items";

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
