import { cacheLife, cacheTag } from "next/cache";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import { categoryNameKey } from "@/lib/categories/name";
import {
  getAdminCategories,
  getCategories,
  insertCategory,
  removeCategory,
  updateCategoryName,
} from "./categories";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// Category rows are global: every name here starts with the scope's tag, no
// assertion counts the whole table, and the production names are never touched.
const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

const rowByKey = (name: string) =>
  db.category.findUnique({ where: { nameKey: categoryNameKey(name) } });

describe("getCategories", () => {
  test("tags its cache entry and lives for days", async () => {
    await getCategories();
    expect(cacheTag).toHaveBeenCalledWith("categories");
    expect(cacheLife).toHaveBeenCalledWith("days");
  });

  test("returns { id, name } only, ordered ignoring case", async () => {
    const names = ["b Shears", "A Rakes", "c Drills"].map(scope.categoryName);
    for (const name of names) await insertCategory(name);

    const own = (await getCategories()).filter(({ name }) =>
      name.startsWith(scope.tag),
    );

    expect(own.map(({ name }) => name)).toEqual([
      scope.categoryName("A Rakes"),
      scope.categoryName("b Shears"),
      scope.categoryName("c Drills"),
    ]);
    for (const row of own)
      expect(Object.keys(row).sort()).toEqual(["id", "name"]);
  });
});

describe("getAdminCategories", () => {
  test("the same rows with inUse false (no item can use one before spec 09)", async () => {
    const { id, name } = await scope.createCategory("Admin row");
    const row = (await getAdminCategories()).find((r) => r.id === id);
    expect(row).toEqual({ id, name, inUse: false });
  });
});

describe("insertCategory", () => {
  test("stores the name as given and its key", async () => {
    const name = scope.categoryName("Garden Tools");
    expect(await insertCategory(name)).toBe("created");
    expect(await rowByKey(name)).toMatchObject({
      name,
      nameKey: name.toLowerCase(),
    });
  });

  test("normalises a name its caller didn't, so name and key agree", async () => {
    expect(await insertCategory(`  ${scope.tag}   Rakes `)).toBe("created");
    expect(await rowByKey(scope.categoryName("rakes"))).toMatchObject({
      name: scope.categoryName("Rakes"),
    });
  });

  test("a name taken in another case is a duplicate and writes nothing", async () => {
    await insertCategory(scope.categoryName("Hoses"));
    expect(await insertCategory(scope.categoryName("HOSES"))).toBe("duplicate");
    expect((await rowByKey(scope.categoryName("hoses")))?.name).toBe(
      scope.categoryName("Hoses"),
    );
  });

  // The unique index decides: one insert wins however the two interleave.
  test("two inserts differing only in case at once make one row", async () => {
    const outcomes = await Promise.all([
      insertCategory(scope.categoryName("Ladder")),
      insertCategory(scope.categoryName("LADDER")),
    ]);
    expect(outcomes.sort()).toEqual(["created", "duplicate"]);
    expect(
      await db.category.count({
        where: { nameKey: categoryNameKey(scope.categoryName("ladder")) },
      }),
    ).toBe(1);
  });

  test("another constraint failure is rethrown, not called a duplicate", async () => {
    const spy = vi
      .spyOn(db.category, "create")
      .mockRejectedValueOnce(new Error("connection lost"));
    await expect(insertCategory(scope.categoryName("Boom"))).rejects.toThrow(
      "connection lost",
    );
    spy.mockRestore();
  });
});

describe("updateCategoryName", () => {
  test("changes that row's name and key only", async () => {
    const target = await scope.createCategory("Old name");
    const other = await scope.createCategory("Other");
    const name = scope.categoryName("New Name");

    expect(await updateCategoryName({ id: target.id, name })).toBe("renamed");

    expect(
      await db.category.findUniqueOrThrow({ where: { id: target.id } }),
    ).toMatchObject({ name, nameKey: name.toLowerCase() });
    expect(
      await db.category.findUniqueOrThrow({ where: { id: other.id } }),
    ).toMatchObject({ name: other.name });
  });

  test("re-casing its own name is allowed", async () => {
    const { id, name } = await scope.createCategory("pruners");
    const recased = scope.categoryName("Pruners");
    expect(await updateCategoryName({ id, name: recased })).toBe("renamed");
    expect((await db.category.findUniqueOrThrow({ where: { id } })).name).toBe(
      recased,
    );
    expect(name).not.toBe(recased);
  });

  test("another category's name in any case is a duplicate", async () => {
    await scope.createCategory("Taken");
    const { id, name } = await scope.createCategory("Free");
    expect(
      await updateCategoryName({ id, name: scope.categoryName("TAKEN") }),
    ).toBe("duplicate");
    expect((await db.category.findUniqueOrThrow({ where: { id } })).name).toBe(
      name,
    );
  });

  test("an unknown id is missing", async () => {
    expect(
      await updateCategoryName({
        id: crypto.randomUUID(),
        name: scope.categoryName("Nobody"),
      }),
    ).toBe("missing");
    expect(await rowByKey(scope.categoryName("Nobody"))).toBeNull();
  });
});

describe("removeCategory", () => {
  test("deletes the row", async () => {
    const { id } = await scope.createCategory("Doomed");
    expect(await removeCategory(id)).toBe("deleted");
    expect(await db.category.findUnique({ where: { id } })).toBeNull();
  });

  test("an unknown or already deleted id is missing", async () => {
    const { id } = await scope.createCategory("Twice");
    await removeCategory(id);
    expect(await removeCategory(id)).toBe("missing");
    expect(await removeCategory(crypto.randomUUID())).toBe("missing");
  });
});
