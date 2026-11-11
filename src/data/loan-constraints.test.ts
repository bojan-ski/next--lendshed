import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { lockActiveOrganizerIds } from "@/data/members";
import { db } from "@/db";
import type { LoanStatus } from "@/generated/prisma/enums";
import { people } from "@/strings/people";
import { isDatesTaken } from "./db-errors";
import { personName } from "./mappers";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();
let ownerId: string;
let borrowerId: string;

beforeAll(async () => {
  await assertMigrated();
  ownerId = (await scope.createTestUser()).id;
  borrowerId = (await scope.createTestUser()).id;
});
afterAll(() => scope.cleanup());

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a rejection");
    },
    (error: unknown) => error,
  );
}

// The driver's SQLSTATE, as the pg adapter passes it through.
function sqlState(error: unknown): unknown {
  const meta = (error as { meta?: { driverAdapterError?: unknown } }).meta;
  const cause = (meta?.driverAdapterError as { cause?: unknown })?.cause;
  return (cause as { originalCode?: unknown })?.originalCode;
}

const item = async () => (await scope.createItem({ ownerId })).id;

const loan = (
  itemId: string,
  status: LoanStatus,
  startDate: string,
  endDate: string,
) => scope.createLoan({ itemId, borrowerId, status, startDate, endDate });

describe("loan_no_overlap", () => {
  test.each([
    ["approved", "approved"],
    ["approved", "out"],
    ["out", "approved"],
    ["out", "out"],
  ] as const)("%s then an overlapping %s fails with 23P01", async (a, b) => {
    const itemId = await item();
    await loan(itemId, a, "2030-06-10", "2030-06-14");

    const error = await thrownBy(loan(itemId, b, "2030-06-12", "2030-06-16"));

    expect(sqlState(error)).toBe("23P01");
    expect(isDatesTaken(error)).toBe(true);
  });

  test("ranges sharing only a boundary day overlap (both ends count)", async () => {
    const itemId = await item();
    await loan(itemId, "approved", "2030-06-10", "2030-06-14");
    const later = await thrownBy(
      loan(itemId, "approved", "2030-06-14", "2030-06-18"),
    );
    const earlier = await thrownBy(
      loan(itemId, "out", "2030-06-06", "2030-06-10"),
    );
    expect(isDatesTaken(later)).toBe(true);
    expect(isDatesTaken(earlier)).toBe(true);
  });

  test("a requested row updated to approved into an overlap fails with 23P01", async () => {
    const itemId = await item();
    await loan(itemId, "approved", "2030-06-10", "2030-06-14");
    const { id } = await loan(itemId, "requested", "2030-06-12", "2030-06-13");

    const error = await thrownBy(
      db.loan.update({ where: { id }, data: { status: "approved" } }),
    );

    expect(isDatesTaken(error)).toBe(true);
    expect((await db.loan.findUniqueOrThrow({ where: { id } })).status).toBe(
      "requested",
    );
  });

  test("adjacent ranges on one item both hold", async () => {
    const itemId = await item();
    await loan(itemId, "approved", "2030-06-10", "2030-06-14");
    await expect(
      loan(itemId, "out", "2030-06-15", "2030-06-20"),
    ).resolves.toHaveProperty("id");
    await expect(
      loan(itemId, "approved", "2030-06-05", "2030-06-09"),
    ).resolves.toHaveProperty("id");
  });

  test("the same days on another item hold", async () => {
    await loan(await item(), "approved", "2030-06-10", "2030-06-14");
    await expect(
      loan(await item(), "approved", "2030-06-10", "2030-06-14"),
    ).resolves.toHaveProperty("id");
  });

  test.each([
    "requested",
    "returned",
    "declined",
    "cancelled",
    "expired",
    "lapsed",
  ] as const)("a %s row conflicts with nothing", async (status) => {
    const itemId = await item();
    await loan(itemId, "approved", "2030-06-10", "2030-06-14");
    await expect(
      loan(itemId, status, "2030-06-10", "2030-06-14"),
    ).resolves.toHaveProperty("id");
    await expect(
      loan(itemId, status, "2030-06-12", "2030-06-20"),
    ).resolves.toHaveProperty("id");
  });
});

describe("isDatesTaken", () => {
  test("is false for a unique violation (P2002)", async () => {
    const { name } = await scope.createCategory("Twice");
    const error = await thrownBy(
      scope.createCategory(name.slice(scope.tag.length + 1)),
    );
    expect((error as { code?: string }).code).toBe("P2002");
    expect(isDatesTaken(error)).toBe(false);
  });

  test("is false for a foreign-key violation (P2003)", async () => {
    const error = await thrownBy(
      scope.createItem({ ownerId, categoryId: crypto.randomUUID() }),
    );
    expect((error as { code?: string }).code).toBe("P2003");
    expect(isDatesTaken(error)).toBe(false);
  });

  test("is false for a CHECK violation and for anything that isn't Prisma's", async () => {
    const check = await thrownBy(
      loan(await item(), "approved", "2030-06-14", "2030-06-10"),
    );
    expect(sqlState(check)).toBe("23514");
    expect(isDatesTaken(check)).toBe(false);
    expect(isDatesTaken(new Error("23P01"))).toBe(false);
    expect(isDatesTaken(null)).toBe(false);
  });
});

describe("CHECK constraints (a direct write that skips Zod)", () => {
  test.each([0, 31])("maxLoanDays %d is refused with 23514", async (days) => {
    const error = await thrownBy(
      scope.createItem({ ownerId, maxLoanDays: days }),
    );
    expect(sqlState(error)).toBe("23514");
  });

  test.each([1, 30])("maxLoanDays %d is stored", async (days) => {
    await expect(
      scope.createItem({ ownerId, maxLoanDays: days }),
    ).resolves.toHaveProperty("id");
  });

  test("an end date before the start is refused with 23514; a one-day loan holds", async () => {
    const itemId = await item();
    const error = await thrownBy(
      loan(itemId, "requested", "2030-06-10", "2030-06-09"),
    );
    expect(sqlState(error)).toBe("23514");
    await expect(
      loan(itemId, "requested", "2030-06-10", "2030-06-10"),
    ).resolves.toHaveProperty("id");
  });
});

describe("delete rules", () => {
  test("an item with any loan row can't be deleted (Restrict, P2003)", async () => {
    const itemId = await item();
    await loan(itemId, "declined", "2030-06-10", "2030-06-12");
    const error = await thrownBy(db.item.delete({ where: { id: itemId } }));
    expect((error as { code?: string }).code).toBe("P2003");
    expect(await db.item.findUnique({ where: { id: itemId } })).not.toBeNull();
  });

  test("deleting the people sets every person column to null, read as Former member", async () => {
    const owner = await scope.createTestUser();
    const borrower = await scope.createTestUser();
    const organizer = await scope.createTestUser();
    const { id: itemId } = await scope.createItem({
      ownerId: owner.id,
      status: "retired",
    });
    await db.item.update({
      where: { id: itemId },
      data: { retiredById: organizer.id },
    });
    const { id: loanId } = await scope.createLoan({
      itemId,
      borrowerId: borrower.id,
      status: "returned",
      startDate: "2030-06-10",
      endDate: "2030-06-12",
      closedById: organizer.id,
    });

    const ids = [owner.id, borrower.id, organizer.id].sort();
    await db.$transaction(async (tx) => {
      await lockActiveOrganizerIds(tx);
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    });

    const itemRow = await db.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { ownerId: true, retiredById: true, owner: true },
    });
    const loanRow = await db.loan.findUniqueOrThrow({
      where: { id: loanId },
      select: { borrowerId: true, closedById: true, borrower: true },
    });
    expect(itemRow).toMatchObject({ ownerId: null, retiredById: null });
    expect(loanRow).toMatchObject({ borrowerId: null, closedById: null });
    expect(personName(itemRow.owner)).toBe(people.formerMember);
    expect(personName(loanRow.borrower)).toBe(people.formerMember);
  });
});
