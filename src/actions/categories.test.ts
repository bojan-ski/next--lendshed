import { isRedirectError } from "next/dist/client/components/redirect-error";
import { updateTag } from "next/cache";
import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import {
  insertCategory,
  removeCategory,
  updateCategoryName,
} from "@/data/categories";
import { db } from "@/db";
import { categoryNameKey } from "@/lib/categories/name";
import { categories } from "@/strings/categories";
import type {
  DeleteCategoryState,
  NewCategoryState,
  RenameCategoryState,
} from "@/types/categories";
import { createCategory, deleteCategory, renameCategory } from "./categories";

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
vi.mock("@/data/categories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/categories")>();
  return {
    ...actual,
    insertCategory: vi.fn(actual.insertCategory),
    updateCategoryName: vi.fn(actual.updateCategoryName),
    removeCategory: vi.fn(actual.removeCategory),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const idleNew: NewCategoryState = {};
const idleRename: RenameCategoryState = {};
const idleDelete: DeleteCategoryState = {};

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

// Signs a fresh user in and makes them the request's viewer.
async function actAs(role: "member" | "organizer") {
  const user = await scope.createTestUser({ role });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

const rowByName = (name: string) =>
  db.category.findUnique({ where: { nameKey: categoryNameKey(name) } });
const rowById = (id: string) => db.category.findUnique({ where: { id } });

describe("createCategory", () => {
  test("stores the normalised name and its key, then revalidates once", async () => {
    await actAs("organizer");
    const typed = `  ${scope.tag}   Garden   tools `;

    const state = await createCategory(idleNew, form({ name: typed }));

    expect(state).toEqual({ flash: "categoryAdded" });
    expect(await rowByName(typed)).toMatchObject({
      name: `${scope.tag} Garden tools`,
      nameKey: `${scope.tag} garden tools`,
    });
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith("categories");
  });

  test.each([
    ["one character", "x", categories.nameTooShort],
    ["31 characters", "x".repeat(31), categories.nameTooLong],
    ["only spaces", "   ", categories.nameTooShort],
  ])(
    "a name of %s is a field error, echoed, writing nothing",
    async (_l, name, message) => {
      await actAs("organizer");
      const state = await createCategory(idleNew, form({ name }));
      expect(state).toEqual({
        fieldErrors: { name: [message] },
        values: { name },
      });
      expect(updateTag).not.toHaveBeenCalled();
      expect(insertCategory).not.toHaveBeenCalled();
    },
  );

  test("a missing name is a field error with an empty echo", async () => {
    await actAs("organizer");
    const state = await createCategory(idleNew, form({}));
    expect(state).toEqual({
      fieldErrors: { name: [categories.nameTooShort] },
      values: { name: "" },
    });
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("a name taken in another case is the duplicate field error", async () => {
    await actAs("organizer");
    const existing = await scope.createCategory("Hoses");
    const typed = scope.categoryName("HOSES");

    const state = await createCategory(idleNew, form({ name: typed }));

    expect(state).toEqual({
      fieldErrors: { name: [categories.nameTaken] },
      values: { name: typed },
    });
    expect((await rowByName(typed))?.id).toBe(existing.id);
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("a data failure is unexpected and revalidates nothing", async () => {
    await actAs("organizer");
    vi.mocked(insertCategory).mockRejectedValueOnce(new Error("boom"));
    const state = await createCategory(
      idleNew,
      form({ name: scope.categoryName("Broken") }),
    );
    expect(state).toEqual({ formError: "unexpected" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("renameCategory", () => {
  test("renames that row only and revalidates once", async () => {
    await actAs("organizer");
    const target = await scope.createCategory("Old");
    const other = await scope.createCategory("Untouched");
    const name = scope.categoryName("New  Name");

    const state = await renameCategory(
      idleRename,
      form({ id: target.id, name }),
    );

    expect(state).toEqual({ flash: "categoryRenamed" });
    expect(await rowById(target.id)).toMatchObject({
      name: scope.categoryName("New Name"),
      nameKey: `${scope.tag} new name`,
    });
    expect((await rowById(other.id))?.name).toBe(other.name);
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith("categories");
  });

  test("re-casing its own name succeeds", async () => {
    await actAs("organizer");
    const { id } = await scope.createCategory("pruners");
    const name = scope.categoryName("Pruners");
    expect(await renameCategory(idleRename, form({ id, name }))).toEqual({
      flash: "categoryRenamed",
    });
    expect((await rowById(id))?.name).toBe(name);
  });

  test("another category's name is the duplicate field error with the typed name", async () => {
    await actAs("organizer");
    await scope.createCategory("Taken");
    const target = await scope.createCategory("Mine");
    const typed = scope.categoryName("taken");

    const state = await renameCategory(
      idleRename,
      form({ id: target.id, name: typed }),
    );

    expect(state).toEqual({
      fieldErrors: { name: [categories.nameTaken] },
      values: { name: typed },
    });
    expect((await rowById(target.id))?.name).toBe(target.name);
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("an invalid name is a field error and writes nothing", async () => {
    await actAs("organizer");
    const target = await scope.createCategory("Valid");
    const state = await renameCategory(
      idleRename,
      form({ id: target.id, name: "x" }),
    );
    expect(state).toEqual({
      fieldErrors: { name: [categories.nameTooShort] },
      values: { name: "x" },
    });
    expect(updateCategoryName).not.toHaveBeenCalled();
  });

  test.each([
    ["an unknown id", () => crypto.randomUUID()],
    ["an empty id", () => ""],
  ])("%s is stale, writes nothing and revalidates nothing", async (_l, id) => {
    await actAs("organizer");
    const name = scope.categoryName("Ghost");
    const state = await renameCategory(idleRename, form({ id: id(), name }));
    expect(state).toEqual({ formError: "stale" });
    expect(await rowByName(name)).toBeNull();
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("a missing id is stale even with a bad name", async () => {
    await actAs("organizer");
    expect(await renameCategory(idleRename, form({ name: "x" }))).toEqual({
      formError: "stale",
    });
  });

  test("a data failure is unexpected", async () => {
    await actAs("organizer");
    const target = await scope.createCategory("Fragile");
    vi.mocked(updateCategoryName).mockRejectedValueOnce(new Error("boom"));
    const state = await renameCategory(
      idleRename,
      form({ id: target.id, name: scope.categoryName("Other") }),
    );
    expect(state).toEqual({ formError: "unexpected" });
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("deleteCategory", () => {
  test("deletes the row and revalidates once", async () => {
    await actAs("organizer");
    const { id } = await scope.createCategory("Doomed");
    expect(await deleteCategory(idleDelete, form({ id }))).toEqual({
      flash: "categoryDeleted",
    });
    expect(await rowById(id)).toBeNull();
    expect(updateTag).toHaveBeenCalledTimes(1);
    expect(updateTag).toHaveBeenCalledWith("categories");
  });

  test.each([
    ["an unknown id", { id: "00000000-0000-4000-8000-000000000000" }],
    ["an empty id", { id: "" }],
    ["no id", {}],
  ])("%s is stale and revalidates nothing", async (_l, fields) => {
    await actAs("organizer");
    expect(await deleteCategory(idleDelete, form(fields))).toEqual({
      formError: "stale",
    });
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("a category an item uses is refused in its row and revalidates nothing", async () => {
    const organizer = await actAs("organizer");
    const { id } = await scope.createCategory("Busy");
    await scope.createItem({ ownerId: organizer.id, categoryId: id });

    expect(await deleteCategory(idleDelete, form({ id }))).toEqual({
      formError: "inUse",
    });
    expect(await rowById(id)).not.toBeNull();
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("an inUse outcome from the data layer maps to the inUse notice", async () => {
    await actAs("organizer");
    const { id } = await scope.createCategory("Raced");
    vi.mocked(removeCategory).mockResolvedValueOnce("inUse");

    expect(await deleteCategory(idleDelete, form({ id }))).toEqual({
      formError: "inUse",
    });
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("a data failure is unexpected and keeps the row", async () => {
    await actAs("organizer");
    const { id } = await scope.createCategory("Sturdy");
    vi.mocked(removeCategory).mockRejectedValueOnce(new Error("boom"));
    expect(await deleteCategory(idleDelete, form({ id }))).toEqual({
      formError: "unexpected",
    });
    expect(await rowById(id)).not.toBeNull();
    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe("guards", () => {
  // Each row writes its own name, so a hole in one action fails only its rows.
  type Call = (id: string, name: string) => Promise<unknown>;
  const calls: [string, Call][] = [
    ["createCategory", (_id, name) => createCategory(idleNew, form({ name }))],
    [
      "renameCategory",
      (id, name) => renameCategory(idleRename, form({ id, name })),
    ],
    ["deleteCategory", (id) => deleteCategory(idleDelete, form({ id }))],
  ];
  const sneaky = (action: string, who: string) =>
    scope.categoryName(`${who} ${action.slice(0, 6)} x`);

  test.each(calls)(
    "%s by a member is not-found and writes nothing",
    async (_n, call) => {
      await actAs("member");
      const target = await scope.createCategory(`Member ${_n.slice(0, 6)}`);

      const error = await thrownBy(call(target.id, sneaky(_n, "M")));

      expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
      expect(await rowById(target.id)).toMatchObject({ name: target.name });
      expect(await rowByName(sneaky(_n, "M"))).toBeNull();
      expect(updateTag).not.toHaveBeenCalled();
    },
  );

  test.each(calls)(
    "%s by a guest redirects to /login and writes nothing",
    async (_n, call) => {
      mockNextRequest({ ip: scope.ip() });
      const target = await scope.createCategory(`Guest ${_n.slice(0, 6)}`);

      const error = await thrownBy(call(target.id, sneaky(_n, "G")));

      expect(isRedirectError(error)).toBe(true);
      expect((error as { digest: string }).digest.split(";")[2]).toBe("/login");
      expect(await rowById(target.id)).toMatchObject({ name: target.name });
      expect(await rowByName(sneaky(_n, "G"))).toBeNull();
      expect(updateTag).not.toHaveBeenCalled();
    },
  );
});
