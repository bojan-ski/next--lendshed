import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { lockActiveOrganizerIds } from "@/data/organizer-locks";
import { db } from "@/db";
import type { LoanStatus } from "@/generated/prisma/enums";
import { fromDbDate } from "./db-dates";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();
let itemId: string;
let borrowerId: string;

beforeAll(async () => {
  await assertMigrated();
  const ownerId = (await scope.createTestUser()).id;
  borrowerId = (await scope.createTestUser()).id;
  ({ id: itemId } = await scope.createItem({ ownerId }));
});
afterAll(() => scope.cleanup());

const loanRow = (id: string) =>
  db.loan.findUniqueOrThrow({
    where: { id },
    select: {
      returnedOn: true,
      returnedAsLent: true,
      endedBy: true,
      systemReason: true,
      closedById: true,
      ownerSeenAt: true,
      borrowerSeenAt: true,
    },
  });

describe("createLoan", () => {
  // Each on its own date range so blocking rows never meet the constraint.
  test.each([
    ["requested", "2030-07-01", {}],
    ["approved", "2030-07-03", {}],
    ["out", "2030-07-05", {}],
    ["expired", "2030-07-07", {}],
    ["lapsed", "2030-07-09", {}],
    ["declined", "2030-07-11", { endedBy: "owner" }],
    ["cancelled", "2030-07-13", { endedBy: "borrower" }],
    [
      "returned",
      "2030-07-15",
      { returnedOn: "2030-07-15", returnedAsLent: "yes" },
    ],
  ] as const)(
    "a %s row gets its status's columns",
    async (status, day, set) => {
      const { id } = await scope.createLoan({
        itemId,
        borrowerId,
        status: status as LoanStatus,
        startDate: day,
        endDate: day,
      });
      const row = await loanRow(id);
      expect({
        ...row,
        returnedOn: row.returnedOn && fromDbDate(row.returnedOn),
      }).toEqual({
        returnedOn: null,
        returnedAsLent: null,
        endedBy: null,
        systemReason: null,
        closedById: null,
        ownerSeenAt: null,
        borrowerSeenAt: null,
        ...set,
      });
    },
  );

  test("the caller overrides a default", async () => {
    const { id } = await scope.createLoan({
      itemId,
      borrowerId,
      status: "returned",
      startDate: "2030-08-01",
      endDate: "2030-08-05",
      returnedOn: "2030-08-03",
      returnedAsLent: "no",
    });
    const row = await loanRow(id);
    expect(row.returnedOn && fromDbDate(row.returnedOn)).toBe("2030-08-03");
    expect(row.returnedAsLent).toBe("no");
  });
});

describe("createItem", () => {
  test("defaults to a Hidden item without a photo, in one of the scope's categories", async () => {
    const ownerId = (await scope.createTestUser()).id;
    const { id } = await scope.createItem({ ownerId });
    const row = await db.item.findUniqueOrThrow({
      where: { id },
      include: { category: true },
    });
    expect(row).toMatchObject({
      status: "hidden",
      listedAt: null,
      retiredAt: null,
      photoKey: null,
      photoUrl: null,
      maxLoanDays: 7,
    });
    expect(row.category.nameKey.startsWith(`${scope.tag} `)).toBe(true);
  });

  test("listed sets listedAt; retired sets retiredAt", async () => {
    const ownerId = (await scope.createTestUser()).id;
    const listed = await scope.createItem({ ownerId, status: "listed" });
    const retired = await scope.createItem({ ownerId, status: "retired" });
    expect(
      (await db.item.findUniqueOrThrow({ where: { id: listed.id } })).listedAt,
    ).not.toBeNull();
    expect(
      (await db.item.findUniqueOrThrow({ where: { id: retired.id } }))
        .retiredAt,
    ).not.toBeNull();
  });
});

describe("cleanup", () => {
  test("leaves no Item, Loan or Category row behind, an owner-nulled item included", async () => {
    const inner = createTestScope();
    const owner = await inner.createTestUser();
    const gone = await inner.createTestUser();
    const borrower = await inner.createTestUser();
    const category = await inner.createCategory("Inner");
    const kept = await inner.createItem({
      ownerId: owner.id,
      categoryId: category.id,
    });
    const orphan = await inner.createItem({ ownerId: gone.id });
    const loans = [
      await inner.createLoan({
        itemId: kept.id,
        borrowerId: borrower.id,
        status: "out",
        startDate: "2030-07-01",
        endDate: "2030-07-03",
      }),
      await inner.createLoan({
        itemId: orphan.id,
        borrowerId: borrower.id,
        status: "returned",
        startDate: "2030-07-01",
        endDate: "2030-07-03",
      }),
    ];
    await db.$transaction(async (tx) => {
      await lockActiveOrganizerIds(tx);
      await tx.user.delete({ where: { id: gone.id } });
    });

    await inner.cleanup();

    const itemIds = [kept.id, orphan.id];
    expect(await db.item.count({ where: { id: { in: itemIds } } })).toBe(0);
    expect(
      await db.loan.count({ where: { id: { in: loans.map(({ id }) => id) } } }),
    ).toBe(0);
    expect(
      await db.category.count({
        where: { nameKey: { startsWith: `${inner.tag} ` } },
      }),
    ).toBe(0);
    expect(
      await db.user.count({
        where: { id: { in: [owner.id, borrower.id] } },
      }),
    ).toBe(0);
  });

  test("both spec 09 migrations are applied to the test database", async () => {
    const applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
    const names = applied.map(({ migration_name }) => migration_name);
    expect(names.some((name) => name.endsWith("_items_and_loans"))).toBe(true);
    expect(names.some((name) => name.endsWith("_loan_no_overlap"))).toBe(true);
  });
});
