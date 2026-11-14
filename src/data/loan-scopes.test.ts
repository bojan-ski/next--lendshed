import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import { toDbDate } from "@/data/db-dates";
import { type MyLoanRow, toLoanCardDTO } from "@/data/my-loans";
import { db } from "@/db";
import type { LoanStatus } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { communityToday } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import type { EffectiveLoanStatus } from "@/types/loan";
import {
  blockingLoanWhere,
  borrowerNeedsActionLoanWhere,
  coversTodayLoanWhere,
  effectiveLoanWhere,
  notFreeTodayLoanWhere,
  occupyingLoanWhere,
  openLoanWhere,
  ownerNeedsActionLoanWhere,
  storedExpiringLoanWhere,
  storedLapsingLoanWhere,
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

// The daily job's tidy set: stored status still the old one, effective status
// already the new one. Never out (overdue included), never a final status.
describe("the stored… fragments agree with effectiveStatus", () => {
  test.each([
    [
      "storedExpiringLoanWhere",
      storedExpiringLoanWhere,
      "requested",
      "expired",
    ],
    ["storedLapsingLoanWhere", storedLapsingLoanWhere, "approved", "lapsed"],
  ] as const)(
    "%s matches exactly the stored %s rows that are effectively %s",
    async (_name, fragment, stored, target) => {
      const expected = idsWhere(
        (row) => row.status === stored && effective(row) === target,
      );
      expect(expected.length).toBeGreaterThan(0);
      expect(await idsMatching(fragment(TODAY))).toEqual(expected);
    },
  );

  test.each([
    ["storedExpiringLoanWhere", storedExpiringLoanWhere, "expired"],
    ["storedLapsingLoanWhere", storedLapsingLoanWhere, "lapsed"],
  ] as const)(
    "%s is a subset of effectiveLoanWhere(%s) and holds no other stored status",
    async (_name, fragment, target) => {
      const matched = await idsMatching(fragment(TODAY));
      const effectiveIds = await idsMatching(effectiveLoanWhere(target, TODAY));
      expect(matched.every((id) => effectiveIds.includes(id))).toBe(true);
      const statuses = new Set(
        rows.filter((row) => matched.includes(row.id)).map((row) => row.status),
      );
      expect(statuses.size).toBe(1);
      for (const status of [
        "out",
        "returned",
        "declined",
        "cancelled",
        "expired",
        "lapsed",
      ] as const) {
        expect(statuses.has(status)).toBe(false);
      }
    },
  );
});

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

// A row in toLoanCardDTO's shape; only its status and dates decide needsYou.
const cardRow = (row: Row): MyLoanRow => ({
  id: row.id,
  status: row.status,
  startDate: toDbDate(row.startDate),
  endDate: toDbDate(row.endDate),
  changedAt: new Date(0),
  ownerSeenAt: null,
  borrowerSeenAt: null,
  item: {
    id: "item",
    title: "Ladder",
    photoUrl: null,
    photoWidth: null,
    photoHeight: null,
    owner: { name: "Olga M." },
  },
  borrower: { name: "Ana P." },
});

// Spec 16: the header count and the Needs you group are one rule. Read at
// 00:30 community time (22:30Z the day before, Belgrade being UTC+2 in June).
describe.each(TEST_ZONES)("the needs-action fragments in %s", (zone) => {
  useProcessTimeZone(zone);
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2030-06-14T22:30:00Z"),
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test.each([
    ["lending", ownerNeedsActionLoanWhere],
    ["borrowing", borrowerNeedsActionLoanWhere],
  ] as const)(
    "the %s fragment matches exactly the rows whose card needs you",
    async (side, fragment) => {
      const today = communityToday();
      expect(today).toBe(TODAY);
      const expected = idsWhere(
        (row) => toLoanCardDTO(cardRow(row), side, today).needsYou !== null,
      );
      expect(expected.length).toBeGreaterThan(0);
      expect(await idsMatching(fragment(today))).toEqual(expected);
    },
  );
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
