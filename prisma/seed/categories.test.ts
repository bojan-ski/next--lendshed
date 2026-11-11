import { assertMigrated } from "@/__tests__/support/test-db";
import { db } from "@/db";
import { categoryNameKey } from "@/lib/categories/name";
import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import { seedCategories } from "./categories";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

beforeAll(assertMigrated);

// The real five only converge here: the seeder never deletes, and the
// assertions are per name, never a count of the shared table.
describe("seedCategories", () => {
  test("leaves each production category present once, run after run", async () => {
    await seedCategories(db);
    await seedCategories(db);

    for (const name of PRODUCTION_CATEGORIES) {
      const rows = await db.category.findMany({
        where: { nameKey: categoryNameKey(name) },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].nameKey).toBe(name.toLowerCase());
    }
  });
});
