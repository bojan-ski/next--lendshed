import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import type { LoanStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { communityToday } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import type { EffectiveLoanStatus } from "@/types/loan";
import {
  blockingLoanWhere,
  coversTodayLoanWhere,
  effectiveLoanWhere,
  notFreeTodayLoanWhere,
  occupyingLoanWhere,
  openLoanWhere,
} from "./loan-scopes";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const scope = createTestScope();

const STORED: LoanStatus[] = [
  "requested",
  "approved",
  "out",
  "returned",
  "declined",
  "cancelled",
  "expired",
  "lapsed",
];
const EFFECTIVE: EffectiveLoanStatus[] = [...STORED, "overdue"];

const TODAY = "2030-06-15";
const BEFORE = "2030-06-10";
const AFTER = "2030-06-20";
// Every (start, end) from {before, at, after} today with start ≤ end.
const RANGES: [string, string][] = [
  [BEFORE, BEFORE],
  [BEFORE, TODAY],
  [BEFORE, AFTER],
  [TODAY, TODAY],
  [TODAY, AFTER],
  [AFTER, AFTER],
];

type Row = {
  id: string;
  status: LoanStatus;
  startDate: string;
  endDate: string;
};
const rows: Row[] = [];

// One row per stored status × range, each on its own item so none conflict.
beforeAll(async () => {
  await assertMigrated();
  const ownerId = (await scope.createTestUser()).id;
  const borrowerId = (await scope.createTestUser()).id;
  const cases = STORED.flatMap((status) =>
    RANGES.map(([startDate, endDate]) => ({ status, startDate, endDate })),
  );
  rows.push(
    ...(await Promise.all(
      cases.map(async (row) => {
        const { id: itemId } = await scope.createItem({ ownerId });
        const { id } = await scope.createLoan({ itemId, borrowerId, ...row });
        return { id, ...row };
      }),
    )),
  );
});
afterAll(() => scope.cleanup());

async function idsMatching(where: Prisma.LoanWhereInput): Promise<string[]> {
  const found = await db.loan.findMany({
    where: { AND: [where, { id: { in: rows.map((row) => row.id) } }] },
    select: { id: true },
  });
  return found.map(({ id }) => id).sort();
}

const idsWhere = (keep: (row: Row) => boolean) =>
  rows
    .filter(keep)
    .map(({ id }) => id)
    .sort();

const effective = (row: Row, today = TODAY) => effectiveStatus(row, today);

describe("effectiveLoanWhere agrees with effectiveStatus", () => {
  test("the fixture covers 48 rows", () => {
    expect(rows).toHaveLength(STORED.length * RANGES.length);
  });

  test.each(EFFECTIVE)(
    "%s matches exactly the rows effectiveStatus gives that status",
    async (status) => {
      const expected = idsWhere((row) => effective(row) === status);
      expect(expected.length).toBeGreaterThan(0);
      expect(await idsMatching(effectiveLoanWhere(status, TODAY))).toEqual(
        expected,
      );
    },
  );

  test("the nine fragments partition the rows", async () => {
    const all = (
      await Promise.all(
        EFFECTIVE.map((status) =>
          idsMatching(effectiveLoanWhere(status, TODAY)),
        ),
      )
    ).flat();
    expect(all.sort()).toEqual(idsWhere(() => true));
  });
});

describe("the composites", () => {
  test("openLoanWhere = effective requested", async () => {
    expect(await idsMatching(openLoanWhere(TODAY))).toEqual(
      idsWhere((row) => effective(row) === "requested"),
    );
  });

  test("blockingLoanWhere = effective approved ∪ out ∪ overdue", async () => {
    expect(await idsMatching(blockingLoanWhere(TODAY))).toEqual(
      idsWhere((row) =>
        ["approved", "out", "overdue"].includes(effective(row)),
      ),
    );
  });

  test("occupyingLoanWhere = every out row, whatever its end date (OQ-34)", async () => {
    expect(await idsMatching(occupyingLoanWhere())).toEqual(
      idsWhere((row) => ["out", "overdue"].includes(effective(row))),
    );
  });

  test("coversTodayLoanWhere = effective approved or out with start ≤ today ≤ end", async () => {
    const expected = idsWhere(
      (row) =>
        ["approved", "out"].includes(effective(row)) &&
        row.startDate <= TODAY &&
        TODAY <= row.endDate,
    );
    expect(expected.length).toBeGreaterThan(0);
    expect(await idsMatching(coversTodayLoanWhere(TODAY))).toEqual(expected);
  });

  test("notFreeTodayLoanWhere = covers today ∪ every out row (OQ-34)", async () => {
    const expected = idsWhere(
      (row) =>
        row.status === "out" ||
        (["approved", "out"].includes(effective(row)) &&
          row.startDate <= TODAY &&
          TODAY <= row.endDate),
    );
    expect(expected).toEqual(
      expect.arrayContaining(idsWhere((row) => effective(row) === "overdue")),
    );
    expect(await idsMatching(notFreeTodayLoanWhere(TODAY))).toEqual(expected);
  });
});

// Belgrade is UTC+1 in November: 22:59:59Z is still the 14th there, 23:00Z the 15th.
describe("around a community midnight", () => {
  test("the fragment follows the community date string, not the UTC one", async () => {
    const before = communityToday(new Date("2030-11-14T22:59:59Z"));
    const after = communityToday(new Date("2030-11-14T23:00:00Z"));
    expect([before, after]).toEqual(["2030-11-14", "2030-11-15"]);

    const ownerId = (await scope.createTestUser()).id;
    const borrowerId = (await scope.createTestUser()).id;
    const { id: itemId } = await scope.createItem({ ownerId });
    const { id } = await scope.createLoan({
      itemId,
      borrowerId,
      status: "approved",
      startDate: "2030-11-12",
      endDate: "2030-11-14",
    });
    const matches = async (status: EffectiveLoanStatus, today: string) =>
      (await db.loan.count({
        where: { AND: [effectiveLoanWhere(status, today), { id }] },
      })) === 1;

    expect(await matches("approved", before)).toBe(true);
    expect(await matches("lapsed", before)).toBe(false);
    expect(await matches("approved", after)).toBe(false);
    expect(await matches("lapsed", after)).toBe(true);
  });
});
