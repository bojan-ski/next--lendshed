import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { categoryNameKey } from "@/lib/categories/name";
import { ensureCategories } from "./categories";
import { createScriptClient } from "./script-db";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// Run-unique names only: the production five are never touched here.
const scope = createTestScope();
const client = createScriptClient(process.env.DATABASE_URL_UNPOOLED!);

beforeAll(assertMigrated);
afterAll(async () => {
  await scope.cleanup();
  await client.$disconnect();
});

const rowFor = (name: string) =>
  client.category.findUnique({ where: { nameKey: categoryNameKey(name) } });

describe("ensureCategories", () => {
  test("creates the absent names, then a second run creates nothing", async () => {
    const names = ["Saws", "Drills", "Paint"].map(scope.categoryName);

    expect(await ensureCategories(client, names)).toEqual({
      created: 3,
      existing: 0,
    });
    expect(await ensureCategories(client, names)).toEqual({
      created: 0,
      existing: 3,
    });
    for (const name of names) {
      expect(await rowFor(name)).toMatchObject({ name });
    }
  });

  test("never renames or re-cases an existing row", async () => {
    const existing = await scope.createCategory("lawn");

    const result = await ensureCategories(client, [
      scope.categoryName("Lawn"),
      scope.categoryName("Hedges"),
    ]);

    expect(result).toEqual({ created: 1, existing: 1 });
    expect(await rowFor(existing.name)).toMatchObject({
      id: existing.id,
      name: existing.name,
    });
  });

  test("names in one list sharing a key count once, stored normalised", async () => {
    const result = await ensureCategories(client, [
      `  ${scope.tag}   Bikes `,
      scope.categoryName("BIKES"),
    ]);
    expect(result).toEqual({ created: 1, existing: 0 });
    expect((await rowFor(scope.categoryName("bikes")))?.name).toBe(
      scope.categoryName("Bikes"),
    );
  });

  test("two runs at once create each name once", async () => {
    const names = ["Tents", "Stoves"].map(scope.categoryName);
    const results = await Promise.all([
      ensureCategories(client, names),
      ensureCategories(client, names),
    ]);
    expect(results.reduce((sum, { created }) => sum + created, 0)).toBe(2);
    for (const name of names) {
      expect(
        await client.category.count({
          where: { nameKey: categoryNameKey(name) },
        }),
      ).toBe(1);
    }
  });
});
