import { isRedirectError } from "next/dist/client/components/redirect-error";
import { refresh, updateTag } from "next/cache";
import { mockNextRequest, readCookie } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import {
  deleteOwnItem,
  hideOwnItem,
  insertItem,
  listOwnItem,
  retireItemByOrganizer,
  retireItemByOwner,
  updateOwnItem,
} from "@/data/items";
import { toDbDate } from "@/data/db-dates";
import { db } from "@/db";
import { addDays, communityToday } from "@/lib/dates/dates";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
import { RETIRED_NOTE_MAX } from "@/lib/schemas/items";
import { t } from "@/lib/text/interpolate";
import { itemPage } from "@/strings/itemPage";
import { items } from "@/strings/items";
import type { ItemDetailsFormState, OrganizerRetireState } from "@/types/item";
import {
  createItem,
  deleteItem,
  hideItem,
  listItem,
  retireItemAsOrganizer,
  retireOwnItem,
  updateItem,
} from "./items";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/items", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/items")>();
  return {
    ...actual,
    insertItem: vi.fn(actual.insertItem),
    updateOwnItem: vi.fn(actual.updateOwnItem),
    listOwnItem: vi.fn(actual.listOwnItem),
    hideOwnItem: vi.fn(actual.hideOwnItem),
    retireItemByOwner: vi.fn(actual.retireItemByOwner),
    retireItemByOrganizer: vi.fn(actual.retireItemByOrganizer),
    deleteOwnItem: vi.fn(actual.deleteOwnItem),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const idle = {};

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected a redirect");
    },
    (thrown: unknown) => thrown,
  );
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

// Signs a fresh user in and makes them the request's viewer.
async function actAs(contactDetails: string | null = null) {
  const user = await scope.createTestUser({ contactDetails });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

let categoryCount = 0;
const newCategory = async () =>
  (await scope.createCategory(`Kind ${++categoryCount}`)).id;

async function detailFields(overrides: Record<string, string> = {}) {
  return {
    title: "Hedge trimmer",
    description: "Cordless",
    categoryId: await newCategory(),
    condition: "worn",
    maxLoanDays: "4",
    pickupNotes: "Ring twice",
    ...overrides,
  };
}

const itemRow = (id: string) => db.item.findUnique({ where: { id } });

describe("createItem", () => {
  test("creates a Hidden item for the viewer, flashes and opens its edit page", async () => {
    const viewer = await actAs();
    const fields = await detailFields();

    const target = await redirectTarget(
      createItem(
        idle,
        form({
          ...fields,
          ownerId: crypto.randomUUID(),
          status: "listed",
          listedAt: "2030-01-01T00:00:00Z",
          photoUrl: "https://example.test/x.webp",
        }),
      ),
    );

    const [row] = await db.item.findMany({ where: { ownerId: viewer.id } });
    expect(target).toBe(`/my/items/${row.id}/edit`);
    expect(readCookie(FLASH_COOKIE)).toBe("itemSaved");
    expect(row).toMatchObject({
      title: "Hedge trimmer",
      maxLoanDays: 4,
      status: "hidden",
      listedAt: null,
      retiredAt: null,
      retiredNote: null,
      photoUrl: null,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("invalid fields → errors on exactly those keys, values echoed, nothing written", async () => {
    const viewer = await actAs();
    const fields = await detailFields({
      title: "ab",
      condition: "broken",
      maxLoanDays: "31",
    });

    const state = await createItem(idle, form(fields));

    expect(Object.keys(state.fieldErrors ?? {}).sort()).toEqual([
      "condition",
      "maxLoanDays",
      "title",
    ]);
    expect(state.fieldErrors?.title).toEqual([items.titleTooShort]);
    expect(state.values).toEqual(fields);
    expect(await db.item.count({ where: { ownerId: viewer.id } })).toBe(0);
  });

  test("at 30 active items → capReached with the values echoed", async () => {
    const viewer = await actAs();
    const categoryId = await newCategory();
    await db.item.createMany({
      data: Array.from({ length: 30 }, (_, n) => ({
        ownerId: viewer.id,
        categoryId,
        title: `Item ${n}`,
        description: "",
        condition: "good" as const,
      })),
    });
    const fields = await detailFields();

    expect(await createItem(idle, form(fields))).toEqual({
      formError: "capReached",
      values: fields,
    });
    expect(await db.item.count({ where: { ownerId: viewer.id } })).toBe(30);
  });

  test("a category removed since the form loaded → a categoryId error", async () => {
    await actAs();
    const fields = await detailFields({ categoryId: crypto.randomUUID() });

    expect(await createItem(idle, form(fields))).toEqual({
      fieldErrors: { categoryId: [items.categoryMissing] },
      values: fields,
    });
  });

  test("a data failure → unexpected with the values echoed", async () => {
    await actAs();
    vi.mocked(insertItem).mockRejectedValueOnce(new Error("boom"));
    const fields = await detailFields();

    expect(await createItem(idle, form(fields))).toEqual({
      formError: "unexpected",
      values: fields,
    });
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });
});

describe("updateItem", () => {
  test("saves an own item in place and refreshes; status is untouched", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({
      ownerId: viewer.id,
      status: "listed",
    });

    const state = await updateItem(
      idle,
      form({ ...(await detailFields()), id, status: "hidden" }),
    );

    expect(state).toEqual({ flash: "itemSaved" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updateTag).not.toHaveBeenCalled();
    expect(await itemRow(id)).toMatchObject({
      title: "Hedge trimmer",
      pickupNotes: "Ring twice",
      status: "listed",
    });
  });

  test("a missing id is stale, even with invalid fields", async () => {
    await actAs();

    expect(
      await updateItem(idle, form(await detailFields({ title: "" }))),
    ).toEqual({ formError: "stale" });
    expect(
      await updateItem(idle, form({ ...(await detailFields()), id: "" })),
    ).toEqual({ formError: "stale" });
  });

  test("someone else's, a retired or an unknown item is stale; nothing written", async () => {
    const viewer = await actAs();
    const others = await scope.createItem({
      ownerId: (await scope.createTestUser()).id,
    });
    const retired = await scope.createItem({
      ownerId: viewer.id,
      status: "retired",
    });

    for (const id of [others.id, retired.id, crypto.randomUUID()]) {
      const before = await itemRow(id);
      expect(
        await updateItem(idle, form({ ...(await detailFields()), id })),
      ).toEqual({ formError: "stale" });
      expect(await itemRow(id)).toEqual(before);
    }
    expect(refresh).not.toHaveBeenCalled();
  });

  test("invalid fields → field errors, values echoed; a gone category → categoryId", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });
    const invalid = await detailFields({ description: "x".repeat(1001) });

    const state: ItemDetailsFormState = await updateItem(
      idle,
      form({ ...invalid, id }),
    );
    expect(state).toEqual({
      fieldErrors: { description: [items.descriptionTooLong] },
      values: invalid,
    });

    const gone = await detailFields({ categoryId: crypto.randomUUID() });
    expect(await updateItem(idle, form({ ...gone, id }))).toEqual({
      fieldErrors: { categoryId: [items.categoryMissing] },
      values: gone,
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a data failure → unexpected with the values echoed", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });
    vi.mocked(updateOwnItem).mockRejectedValueOnce(new Error("boom"));
    const fields = await detailFields();

    expect(await updateItem(idle, form({ ...fields, id }))).toEqual({
      formError: "unexpected",
      values: fields,
    });
  });
});

describe("listItem", () => {
  test("no photo → needsPhoto; no contact details → needsContactDetails", async () => {
    const viewer = await actAs(null);
    const bare = await scope.createItem({ ownerId: viewer.id });
    const withPhoto = await scope.createItem({
      ownerId: viewer.id,
      photo: true,
    });

    expect(await listItem(idle, form({ id: bare.id }))).toEqual({
      formError: "needsPhoto",
    });
    expect(await listItem(idle, form({ id: withPhoto.id }))).toEqual({
      formError: "needsContactDetails",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a photo and contact details → listed in place", async () => {
    const viewer = await actAs("Phone 555");
    const { id } = await scope.createItem({ ownerId: viewer.id, photo: true });

    expect(await listItem(idle, form({ id }))).toEqual({ flash: "itemListed" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await itemRow(id))?.status).toBe("listed");
  });

  test("a missing id or someone else's item is stale", async () => {
    await actAs("Phone 555");
    const others = await scope.createItem({
      ownerId: (await scope.createTestUser({ contactDetails: "x" })).id,
      photo: true,
    });

    expect(await listItem(idle, new FormData())).toEqual({
      formError: "stale",
    });
    expect(await listItem(idle, form({ id: others.id }))).toEqual({
      formError: "stale",
    });
    expect((await itemRow(others.id))?.status).toBe("hidden");
  });
});

describe("hideItem", () => {
  test("hides a listed item in place and declines its open request", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({
      ownerId: viewer.id,
      status: "listed",
    });
    const start = addDays(communityToday(), 3);
    const open = await scope.createLoan({
      itemId: id,
      borrowerId: (await scope.createTestUser()).id,
      status: "requested",
      startDate: start,
      endDate: start,
    });

    expect(await hideItem(idle, form({ id }))).toEqual({ flash: "itemHidden" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(
      await db.loan.findUniqueOrThrow({ where: { id: open.id } }),
    ).toMatchObject({
      status: "declined",
      endedBy: "system",
      systemReason: "item_hidden",
      startDate: toDbDate(start),
    });
  });

  test("a hidden item is stale, no refresh", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });

    expect(await hideItem(idle, form({ id }))).toEqual({ formError: "stale" });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("retireOwnItem", () => {
  test("an approved loan → blocked; without one → retired in place", async () => {
    const viewer = await actAs();
    const blocked = await scope.createItem({ ownerId: viewer.id });
    const start = addDays(communityToday(), 2);
    await scope.createLoan({
      itemId: blocked.id,
      borrowerId: (await scope.createTestUser()).id,
      status: "approved",
      startDate: start,
      endDate: start,
    });
    const free = await scope.createItem({ ownerId: viewer.id });

    expect(await retireOwnItem(idle, form({ id: blocked.id }))).toEqual({
      formError: "blocked",
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(await retireOwnItem(idle, form({ id: free.id }))).toEqual({
      flash: "itemRetired",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await itemRow(free.id)).toMatchObject({
      status: "retired",
      retiredNote: null,
      retiredById: null,
    });
  });

  test("a retired item or a missing id is stale", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({
      ownerId: viewer.id,
      status: "retired",
    });

    expect(await retireOwnItem(idle, form({ id }))).toEqual({
      formError: "stale",
    });
    expect(await retireOwnItem(idle, new FormData())).toEqual({
      formError: "stale",
    });
  });
});

describe("deleteItem", () => {
  test("an item with no loans is deleted; flash and redirect to My items", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });

    expect(await redirectTarget(deleteItem(idle, form({ id })))).toBe(
      "/my/items",
    );
    expect(readCookie(FLASH_COOKIE)).toBe("itemDeleted");
    expect(await itemRow(id)).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("any loan row → hasLoans; someone else's item → stale; both kept", async () => {
    const viewer = await actAs();
    const loaned = await scope.createItem({ ownerId: viewer.id });
    await scope.createLoan({
      itemId: loaned.id,
      borrowerId: (await scope.createTestUser()).id,
      status: "declined",
      startDate: "2030-05-01",
      endDate: "2030-05-02",
    });
    const others = await scope.createItem({
      ownerId: (await scope.createTestUser()).id,
    });

    expect(await deleteItem(idle, form({ id: loaned.id }))).toEqual({
      formError: "hasLoans",
    });
    expect(await deleteItem(idle, form({ id: others.id }))).toEqual({
      formError: "stale",
    });
    expect(await itemRow(loaned.id)).not.toBeNull();
    expect(await itemRow(others.id)).not.toBeNull();
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });
});

describe("retireItemAsOrganizer", () => {
  const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
  const unretired: OrganizerRetireState = {};
  const note = "Broken blade, unsafe to lend.";

  async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => {
        throw new Error("expected a throw");
      },
      (error: unknown) => error,
    );
  }

  async function actAsOrganizer() {
    const user = await scope.createTestUser({ role: "organizer" });
    const ip = scope.ip();
    const cookie = await signInForCookie({ ...user, ip });
    mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
    return user;
  }

  // Another member's listed item.
  const othersItem = async () =>
    scope.createItem({
      ownerId: (await scope.createTestUser()).id,
      status: "listed",
    });

  test("retires another member's item: note, retirer, flash, redirect to Browse", async () => {
    const { id } = await othersItem();
    const organizer = await actAsOrganizer();

    expect(
      await redirectTarget(
        retireItemAsOrganizer(unretired, form({ id, note: `  ${note}  ` })),
      ),
    ).toBe("/");
    expect(readCookie(FLASH_COOKIE)).toBe("itemRetired");
    expect(await itemRow(id)).toMatchObject({
      status: "retired",
      retiredNote: note,
      retiredById: organizer.id,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("signed out → /login; a member → not-found; nothing written", async () => {
    const { id } = await othersItem();
    mockNextRequest({ ip: scope.ip() });
    expect(
      await redirectTarget(
        retireItemAsOrganizer(unretired, form({ id, note })),
      ),
    ).toMatch(/^\/login/);

    await actAs();
    const error = await thrownBy(
      retireItemAsOrganizer(unretired, form({ id, note })),
    );
    expect((error as { digest?: string }).digest).toBe(NOT_FOUND);

    expect(retireItemByOrganizer).not.toHaveBeenCalled();
    expect((await itemRow(id))?.status).toBe("listed");
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });

  test("a missing or empty id → stale, no field error", async () => {
    await actAsOrganizer();
    expect(await retireItemAsOrganizer(unretired, form({ note }))).toEqual({
      formError: "stale",
    });
    expect(
      await retireItemAsOrganizer(unretired, form({ id: "", note })),
    ).toEqual({ formError: "stale" });
  });

  test.each([
    ["no note", undefined, itemPage.retireNoteRequired],
    ["an empty note", "", itemPage.retireNoteRequired],
    ["a whitespace-only note", " \r\n ", itemPage.retireNoteRequired],
    [
      "a 301-character note once CRLF is one character",
      "x".repeat(150) + "\r\n" + "x".repeat(150),
      t(itemPage.retireNoteTooLong, { max: RETIRED_NOTE_MAX }),
    ],
  ])(
    "%s → fieldErrors.note, echoed, nothing written",
    async (_, value, message) => {
      const { id } = await othersItem();
      await actAsOrganizer();
      const fields: Record<string, string> =
        value === undefined ? { id } : { id, note: value };

      expect(await retireItemAsOrganizer(unretired, form(fields))).toEqual({
        fieldErrors: { note: [message] },
        values: { note: value ?? "" },
      });
      expect((await itemRow(id))?.status).toBe("listed");
      expect(readCookie(FLASH_COOKIE)).toBeUndefined();
    },
  );

  test("the organizer's own item, or a retired one → stale, nothing written", async () => {
    const organizer = await actAsOrganizer();
    const own = await scope.createItem({
      ownerId: organizer.id,
      status: "listed",
    });
    const retired = await scope.createItem({
      ownerId: (await scope.createTestUser()).id,
      status: "retired",
    });

    for (const id of [own.id, retired.id]) {
      expect(
        await retireItemAsOrganizer(unretired, form({ id, note })),
      ).toEqual({ formError: "stale" });
    }
    expect((await itemRow(own.id))?.status).toBe("listed");
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });

  test("an item with an out loan → stillOut, nothing written", async () => {
    const { id } = await othersItem();
    await scope.createLoan({
      itemId: id,
      borrowerId: (await scope.createTestUser()).id,
      status: "out",
      startDate: addDays(communityToday(), -5),
      endDate: addDays(communityToday(), -2),
    });
    await actAsOrganizer();

    expect(await retireItemAsOrganizer(unretired, form({ id, note }))).toEqual({
      formError: "stillOut",
    });
    expect((await itemRow(id))?.status).toBe("listed");
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });

  test("a data failure → reported, unexpected with the note, no flash", async () => {
    const { id } = await othersItem();
    await actAsOrganizer();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(retireItemByOrganizer).mockRejectedValueOnce(new Error("boom"));

    expect(await retireItemAsOrganizer(unretired, form({ id, note }))).toEqual({
      formError: "unexpected",
      values: { note },
    });
    expect(report).toHaveBeenCalledWith(
      "retireItemAsOrganizer: unexpected",
      expect.objectContaining({ name: "Error", message: "boom" }),
    );
    expect((await itemRow(id))?.status).toBe("listed");
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });
});

describe("a data failure on a button action is unexpected, with no refresh", () => {
  test.each([
    ["listItem", listItem, listOwnItem],
    ["hideItem", hideItem, hideOwnItem],
    ["retireOwnItem", retireOwnItem, retireItemByOwner],
    ["deleteItem", deleteItem, deleteOwnItem],
  ] as const)("%s", async (_name, action, data) => {
    await actAs();
    vi.mocked(data).mockRejectedValueOnce(new Error("boom"));

    expect(await action(idle, form({ id: crypto.randomUUID() }))).toEqual({
      formError: "unexpected",
    });
    expect(refresh).not.toHaveBeenCalled();
  });
});
