import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import {
  ITEM_CONDITIONS,
  ITEM_MAX_LOAN_DAYS,
  ITEM_TITLE_MAX,
  ITEM_TITLE_MIN,
} from "@/lib/schemas/items";
import { ensureItems, SEED_ITEMS, type SeedItem } from "./items";
import { SEED_PEOPLE } from "./people";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// Converges on scope users and scope categories only; the real cast is untouched.
const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

const itemsOf = (ownerId: string, title: string) =>
  db.item.findMany({
    where: { ownerId, title },
    select: {
      status: true,
      categoryId: true,
      condition: true,
      maxLoanDays: true,
      photoUrl: true,
    },
  });

describe("ensureItems", () => {
  test("creates each entry once, Hidden with no photo, and a second run changes nothing", async () => {
    const ana = await scope.createTestUser();
    const tom = await scope.createTestUser();
    const tools = await scope.createCategory("Tools");
    const garden = await scope.createCategory("Garden");
    const entries: SeedItem[] = [
      {
        ownerEmail: ana.email,
        category: tools.name,
        title: "Drill",
        condition: "new",
        maxLoanDays: 3,
      },
      {
        ownerEmail: ana.email,
        category: garden.name,
        title: "Rake",
        condition: "worn",
        maxLoanDays: 7,
      },
      {
        ownerEmail: tom.email,
        category: tools.name,
        title: "Drill",
        condition: "good",
        maxLoanDays: 5,
      },
    ];

    expect(await ensureItems(db, entries)).toEqual({ created: 3, existing: 0 });
    const anaDrill = await db.item.findFirstOrThrow({
      where: { ownerId: ana.id, title: "Drill" },
    });
    await db.item.update({
      where: { id: anaDrill.id },
      data: { maxLoanDays: 9 },
    });
    expect(await ensureItems(db, entries)).toEqual({ created: 0, existing: 3 });

    expect(await itemsOf(ana.id, "Drill")).toEqual([
      {
        status: "hidden",
        categoryId: tools.id,
        condition: "new",
        maxLoanDays: 9,
        photoUrl: null,
      },
    ]);
    expect(await itemsOf(ana.id, "Rake")).toEqual([
      {
        status: "hidden",
        categoryId: garden.id,
        condition: "worn",
        maxLoanDays: 7,
        photoUrl: null,
      },
    ]);
    expect(await itemsOf(tom.id, "Drill")).toEqual([
      {
        status: "hidden",
        categoryId: tools.id,
        condition: "good",
        maxLoanDays: 5,
        photoUrl: null,
      },
    ]);
  });

  test("finds the category by its name key, whatever the case", async () => {
    const owner = await scope.createTestUser();
    const kids = await scope.createCategory("Kids");
    await ensureItems(db, [
      {
        ownerEmail: owner.email,
        category: kids.name.toUpperCase(),
        title: "Cot",
        condition: "good",
        maxLoanDays: 14,
      },
    ]);
    expect((await itemsOf(owner.id, "Cot"))[0]?.categoryId).toBe(kids.id);
  });

  test("a missing owner or category stops with a clear message and creates nothing", async () => {
    const owner = await scope.createTestUser();
    const category = await scope.createCategory("Stops");
    const entry = {
      category: category.name,
      title: "Saw",
      condition: "good",
      maxLoanDays: 3,
    } as const;

    await expect(
      ensureItems(db, [{ ...entry, ownerEmail: scope.email() }]),
    ).rejects.toThrow(/no member .*Seed people first/);
    await expect(
      ensureItems(db, [
        {
          ...entry,
          ownerEmail: owner.email,
          category: scope.categoryName("Nope"),
        },
      ]),
    ).rejects.toThrow(/no category .*Seed categories first/);
    expect(await itemsOf(owner.id, "Saw")).toEqual([]);
  });
});

describe("SEED_ITEMS", () => {
  const owners = new Set(SEED_ITEMS.map((item) => item.ownerEmail));

  test("every owner is a seed person and every category a production one", () => {
    const emails = SEED_PEOPLE.map((person) => person.email);
    for (const item of SEED_ITEMS) {
      expect(emails).toContain(item.ownerEmail);
      expect(PRODUCTION_CATEGORIES).toContain(item.category);
    }
  });

  test("uses all five categories", () => {
    expect(new Set(SEED_ITEMS.map((item) => item.category))).toEqual(
      new Set(PRODUCTION_CATEGORIES),
    );
  });

  test("every active person owns an item, and so does the suspended one", () => {
    for (const person of SEED_PEOPLE) expect(owners).toContain(person.email);
    expect(SEED_PEOPLE.some((person) => person.status === "suspended")).toBe(
      true,
    );
  });

  test("each entry passes the item limits and is unique per owner", () => {
    const keys = SEED_ITEMS.map((item) => `${item.ownerEmail}|${item.title}`);
    expect(new Set(keys).size).toBe(SEED_ITEMS.length);
    for (const item of SEED_ITEMS) {
      expect(item.title.length).toBeGreaterThanOrEqual(ITEM_TITLE_MIN);
      expect(item.title.length).toBeLessThanOrEqual(ITEM_TITLE_MAX);
      expect(ITEM_CONDITIONS).toContain(item.condition);
      expect(item.maxLoanDays).toBeGreaterThanOrEqual(1);
      expect(item.maxLoanDays).toBeLessThanOrEqual(ITEM_MAX_LOAN_DAYS);
    }
  });
});
