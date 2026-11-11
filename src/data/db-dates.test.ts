import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import { db } from "@/db";
import { fromDbDate, toDbDate } from "./db-dates";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();
let itemId: string;
let borrowerId: string;

beforeAll(async () => {
  await assertMigrated();
  const owner = await scope.createTestUser();
  const borrower = await scope.createTestUser();
  borrowerId = borrower.id;
  ({ id: itemId } = await scope.createItem({ ownerId: owner.id }));
});
afterAll(() => scope.cleanup());

// Year ends, a leap day and the DST changes in Belgrade, New York and Auckland.
const DATES = [
  "2026-01-01",
  "2026-12-31",
  "2028-02-29",
  "2026-03-08",
  "2026-03-29",
  "2026-04-05",
  "2026-09-27",
  "2026-10-25",
  "2026-11-01",
];

describe.each(TEST_ZONES)("db dates in %s", (zone) => {
  useProcessTimeZone(zone);

  test.each(DATES)("%s survives toDbDate → fromDbDate", (date) => {
    expect(toDbDate(date).toISOString()).toBe(`${date}T00:00:00.000Z`);
    expect(fromDbDate(toDbDate(date))).toBe(date);
  });

  test("a @db.Date column reads back as the same day", async () => {
    const { id } = await scope.createLoan({
      itemId,
      borrowerId,
      status: "requested",
      startDate: "2026-03-29",
      endDate: "2026-10-25",
    });
    const row = await db.loan.findUniqueOrThrow({
      where: { id },
      select: { startDate: true, endDate: true },
    });
    expect(fromDbDate(row.startDate)).toBe("2026-03-29");
    expect(fromDbDate(row.endDate)).toBe("2026-10-25");
  });
});

describe("toDbDate", () => {
  test.each(["2026-02-30", "2026-1-5", "", "2026-11-11T00:00", "11/11/2026"])(
    "throws on %j",
    (value) => {
      expect(() => toDbDate(value)).toThrow(RangeError);
    },
  );
});
