import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { fromDbDate } from "@/data/db-dates";
import { db } from "@/db";
import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import { addDays, loanLengthDays } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import {
  DEMO_SCENARIO,
  type DemoScenarioEntry,
  type DemoScenarioItem,
  type DemoScenarioKind,
  demoScenarioMarker,
  ensureDemoScenario,
} from "./demo-scenario";
import { SEED_ITEMS } from "./items";
import { SEED_PEOPLE } from "./people";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// Converges on scope users, items and a scope category; the real cast is
// untouched.
const scope = createTestScope();
beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

const TODAY = "2026-11-15";

// The spec's table, written out independently of the seeder.
const EXPECTED: Record<
  DemoScenarioKind,
  {
    status: string;
    endedBy: string | null;
    systemReason: string | null;
    reason: boolean;
    returnedAsLent: string | null;
    closed: boolean;
    borrower: boolean;
  }
> = {
  declined: {
    status: "declined",
    endedBy: "owner",
    systemReason: null,
    reason: true,
    returnedAsLent: null,
    closed: false,
    borrower: true,
  },
  cancelled: {
    status: "cancelled",
    endedBy: "borrower",
    systemReason: null,
    reason: true,
    returnedAsLent: null,
    closed: false,
    borrower: true,
  },
  "owner-suspended": {
    status: "declined",
    endedBy: "system",
    systemReason: "owner_suspended",
    reason: false,
    returnedAsLent: null,
    closed: false,
    borrower: true,
  },
  "organizer-closed": {
    status: "returned",
    endedBy: null,
    systemReason: null,
    reason: true,
    returnedAsLent: "unknown",
    closed: true,
    borrower: true,
  },
  "owner-retired": {
    status: "returned",
    endedBy: null,
    systemReason: null,
    reason: false,
    returnedAsLent: "yes",
    closed: false,
    borrower: true,
  },
  "organizer-retired": {
    status: "cancelled",
    endedBy: "organizer",
    systemReason: "item_retired",
    reason: false,
    returnedAsLent: null,
    closed: false,
    borrower: true,
  },
  "former-borrower": {
    status: "returned",
    endedBy: null,
    systemReason: null,
    reason: false,
    returnedAsLent: "yes",
    closed: false,
    borrower: false,
  },
  "former-owner": {
    status: "returned",
    endedBy: null,
    systemReason: null,
    reason: false,
    returnedAsLent: "yes",
    closed: false,
    borrower: true,
  },
};

const isScenarioItem = (
  item: DemoScenarioEntry["item"],
): item is DemoScenarioItem => "category" in item;

type Cast = {
  entries: DemoScenarioEntry[];
  itemIds: string[];
  organizerId: string;
  borrowerId: string;
};

let copies = 0;

// DEMO_SCENARIO on scope people: one active owner, a suspended owner, a
// borrower and an organizer; seed items become listed scope items, scenario
// items take the scope category. Titles carry the scope tag and a copy number,
// so copies never share an item (the ownerless one is keyed by title alone).
async function copyOfTheScenario(): Promise<Cast> {
  const copy = ++copies;
  const owner = await scope.createTestUser({ name: "Owen O." });
  const suspended = await scope.createTestUser({
    name: "Sue S.",
    status: "suspended",
  });
  const borrower = await scope.createTestUser({ name: "Bea B." });
  const organizer = await scope.createTestUser({
    name: "Ola O.",
    role: "organizer",
  });
  const category = await scope.createCategory(`Demo ${copy}`);
  const entries: DemoScenarioEntry[] = [];
  for (const entry of DEMO_SCENARIO) {
    const title = `${scope.tag} ${copy} ${entry.item.title}`;
    const ownerEmail =
      entry.item.ownerEmail === null
        ? null
        : entry.kind === "owner-suspended"
          ? suspended.email
          : owner.email;
    if (!isScenarioItem(entry.item)) {
      const ownerId =
        entry.kind === "owner-suspended" ? suspended.id : owner.id;
      await scope.createItem({ ownerId, title, status: "listed", photo: true });
    }
    entries.push({
      ...entry,
      item: isScenarioItem(entry.item)
        ? { ...entry.item, ownerEmail, title, category: category.name }
        : { ownerEmail: ownerEmail!, title },
      borrowerEmail: entry.borrowerEmail === null ? null : borrower.email,
      ...(entry.organizerEmail && { organizerEmail: organizer.email }),
    });
  }
  return {
    entries,
    itemIds: [],
    organizerId: organizer.id,
    borrowerId: borrower.id,
  };
}

// Runs the seeder and tracks the ownerless item it may have created.
async function run(cast: Cast, today: string) {
  const result = await ensureDemoScenario(db, cast.entries, today);
  const titles = cast.entries.map(({ item }) => item.title);
  const items = await db.item.findMany({
    where: { title: { in: titles } },
    select: { id: true, ownerId: true },
  });
  for (const { id, ownerId } of items) {
    if (ownerId === null && !cast.itemIds.includes(id)) scope.trackItem(id);
  }
  cast.itemIds = items.map(({ id }) => id);
  return result;
}

const loans = (cast: Cast) =>
  db.loan.findMany({
    where: {
      itemId: { in: cast.itemIds },
      requestMessage: { startsWith: "demo-scenario:" },
    },
    orderBy: { requestMessage: "asc" },
    omit: { updatedAt: true },
    include: {
      item: { omit: { updatedAt: true, createdAt: true } },
    },
  });

function expectScenario(
  rows: Awaited<ReturnType<typeof loans>>,
  cast: Cast,
  today: string,
) {
  expect(rows).toHaveLength(cast.entries.length);
  for (const entry of cast.entries) {
    const row = rows.find(
      ({ requestMessage }) => requestMessage === demoScenarioMarker(entry.kind),
    );
    expect(row, entry.kind).toBeDefined();
    const want = EXPECTED[entry.kind];
    const startDate = fromDbDate(row!.startDate);
    const endDate = fromDbDate(row!.endDate);
    expect(
      {
        status: row!.status,
        startDate,
        endDate,
        endedBy: row!.endedBy,
        systemReason: row!.systemReason,
        statusReason: row!.statusReason,
        returnedOn: row!.returnedOn && fromDbDate(row!.returnedOn),
        returnedAsLent: row!.returnedAsLent,
        closedById: row!.closedById,
        borrowerId: row!.borrowerId,
        seen: [row!.ownerSeenAt, row!.borrowerSeenAt],
      },
      entry.kind,
    ).toEqual({
      status: want.status,
      startDate: addDays(today, entry.startOffset),
      endDate: addDays(today, entry.endOffset),
      endedBy: want.endedBy,
      systemReason: want.systemReason,
      statusReason: want.reason ? entry.note : null,
      returnedOn:
        want.status === "returned"
          ? addDays(today, entry.returnedOffset ?? entry.endOffset)
          : null,
      returnedAsLent: want.returnedAsLent,
      closedById: want.closed ? cast.organizerId : null,
      borrowerId: want.borrower ? cast.borrowerId : null,
      seen: [null, null],
    });
    expect(
      effectiveStatus({ status: row!.status, startDate, endDate }, today),
    ).toBe(row!.status);

    const item = row!.item;
    if (isScenarioItem(entry.item)) {
      const byOrganizer = entry.kind === "organizer-retired";
      expect(
        {
          status: item.status,
          listedAt: item.listedAt,
          retiredAt: item.retiredAt?.toISOString().slice(0, 10),
          retiredNote: item.retiredNote,
          retiredById: item.retiredById,
          photo: [item.photoKey, item.photoUrl, item.photoBytes],
          owned: item.ownerId !== null,
        },
        entry.kind,
      ).toEqual({
        status: "retired",
        listedAt: null,
        retiredAt: addDays(today, entry.item.retiredOffset),
        retiredNote: byOrganizer ? entry.note : null,
        retiredById: byOrganizer ? cast.organizerId : null,
        photo: [null, null, null],
        owned: entry.item.ownerEmail !== null,
      });
    } else {
      expect(item.status, entry.kind).toBe("listed");
    }
  }
}

describe("ensureDemoScenario", () => {
  test("creates every kind with its columns, then converges without changing anything", async () => {
    const cast = await copyOfTheScenario();

    expect(await run(cast, TODAY)).toEqual({ created: 8, updated: 0 });
    const first = await loans(cast);
    expectScenario(first, cast, TODAY);
    expect(first.filter(({ item }) => item.status === "retired")).toHaveLength(
      3,
    );

    expect(await run(cast, TODAY)).toEqual({ created: 0, updated: 8 });
    expect(await loans(cast)).toEqual(first);
  });

  test("a later today re-dates every row in place and moves nothing else", async () => {
    const cast = await copyOfTheScenario();
    await run(cast, TODAY);
    const before = await loans(cast);

    const later = addDays(TODAY, 9);
    await run(cast, later);
    const after = await loans(cast);

    expect(after.map(({ id }) => id)).toEqual(before.map(({ id }) => id));
    expect(after.map(({ item }) => item.id)).toEqual(
      before.map(({ item }) => item.id),
    );
    expectScenario(after, cast, later);
  });

  test("no row is approved or out, and none overlaps the exclusion constraint", async () => {
    const cast = await copyOfTheScenario();
    await run(cast, TODAY);
    const statuses = (await loans(cast)).map(({ status }) => status);
    expect(
      statuses.filter((status) => status === "approved" || status === "out"),
    ).toEqual([]);
  });

  test("an unmarked loan on a scenario's seed item is left alone", async () => {
    const cast = await copyOfTheScenario();
    await run(cast, TODAY);
    const seedItemId = (await loans(cast)).find(
      ({ requestMessage }) => requestMessage === demoScenarioMarker("declined"),
    )!.itemId;
    const other = await scope.createTestUser();
    const { id } = await scope.createLoan({
      itemId: seedItemId,
      borrowerId: other.id,
      status: "declined",
      startDate: addDays(TODAY, -40),
      endDate: addDays(TODAY, -39),
    });
    const unmarked = () => db.loan.findUniqueOrThrow({ where: { id } });
    const before = await unmarked();

    await run(cast, addDays(TODAY, 3));

    expect(await unmarked()).toEqual(before);
  });
});

describe("refusals name the entry and write nothing for it", () => {
  const entryOf = (cast: Cast, kind: DemoScenarioKind) =>
    cast.entries.find((entry) => entry.kind === kind)!;
  const named = (entry: DemoScenarioEntry, reason: RegExp) =>
    new RegExp(
      `Demo scenario ${entry.kind} on "${entry.item.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}": .*${reason.source}`,
    );

  test.each<
    [
      string,
      DemoScenarioKind,
      (
        cast: Cast,
        entry: DemoScenarioEntry,
        people: Record<string, string>,
      ) => DemoScenarioEntry,
      RegExp,
    ]
  >([
    [
      "a person is missing",
      "declined",
      (_c, entry) => ({
        ...entry,
        borrowerEmail: `${scope.tag}-nobody@test.invalid`,
      }),
      /no member/,
    ],
    [
      "the owner-suspended owner is active",
      "owner-suspended",
      (_c, entry, people) => ({
        ...entry,
        item: { ...entry.item, ownerEmail: people.active },
      }),
      /owner must be suspended/,
    ],
    [
      "another kind's owner is suspended",
      "declined",
      (_c, entry, people) => ({
        ...entry,
        item: { ...entry.item, ownerEmail: people.suspended },
      }),
      /owner must be active/,
    ],
    [
      "the closing organizer is a member",
      "organizer-closed",
      (_c, entry, people) => ({ ...entry, organizerEmail: people.member }),
      /active organizer who is neither party/,
    ],
    [
      "the closing organizer is suspended",
      "organizer-closed",
      (_c, entry, people) => ({
        ...entry,
        organizerEmail: people.suspendedOrganizer,
      }),
      /active organizer who is neither party/,
    ],
    [
      "the closing organizer is the borrower",
      "organizer-closed",
      (_c, entry, people) => ({ ...entry, borrowerEmail: people.organizer }),
      /active organizer who is neither party/,
    ],
    [
      "the retiring organizer owns the item",
      "organizer-retired",
      (_c, entry, people) => ({
        ...entry,
        item: { ...entry.item, ownerEmail: people.organizer },
      }),
      /active organizer who is neither party/,
    ],
    [
      "an organizer kind has no organizer",
      "organizer-retired",
      (_c, entry) => ({ ...entry, organizerEmail: undefined }),
      /needs organizer/,
    ],
    [
      "the seed item is missing",
      "cancelled",
      (_c, entry) => ({
        ...entry,
        item: { ...entry.item, title: `${scope.tag} no such thing` },
      }),
      /no such item/,
    ],
    [
      "the borrower is not active",
      "declined",
      (_c, entry, people) => ({ ...entry, borrowerEmail: people.suspended }),
      /borrower must be another active member/,
    ],
    [
      "the borrower is the owner",
      "declined",
      (_c, entry) => ({ ...entry, borrowerEmail: entry.item.ownerEmail }),
      /borrower must be another active member/,
    ],
  ])("%s", async (_name, kind, change, reason) => {
    const cast = await copyOfTheScenario();
    const people = {
      active: (await scope.createTestUser()).email,
      member: (await scope.createTestUser()).email,
      suspended: (await scope.createTestUser({ status: "suspended" })).email,
      suspendedOrganizer: (
        await scope.createTestUser({ role: "organizer", status: "suspended" })
      ).email,
      organizer: cast.entries.find(({ organizerEmail }) => organizerEmail)!
        .organizerEmail!,
    };
    const entry = change(cast, entryOf(cast, kind), people);

    await expect(ensureDemoScenario(db, [entry], TODAY)).rejects.toThrow(
      named(entry, reason),
    );
    expect(
      await db.loan.count({
        where: {
          requestMessage: demoScenarioMarker(kind),
          item: { title: entry.item.title },
        },
      }),
    ).toBe(0);
    expect(
      await db.item.count({
        where: { title: entry.item.title, status: "retired" },
      }),
    ).toBe(0);
  });
});

describe("DEMO_SCENARIO on the real cast", () => {
  const people = new Map(SEED_PEOPLE.map((person) => [person.email, person]));
  const seedItem = (owner: string | null, title: string) =>
    SEED_ITEMS.find(
      ({ ownerEmail, title: seedTitle }) =>
        ownerEmail === owner && seedTitle === title,
    );

  test("one entry per kind", () => {
    expect(DEMO_SCENARIO.map(({ kind }) => kind).sort()).toEqual(
      Object.keys(EXPECTED).sort(),
    );
  });

  test.each(DEMO_SCENARIO)(
    "$kind: ended over a week ago, seed people in the right roles, a real item",
    (entry) => {
      expect(entry.startOffset).toBeLessThanOrEqual(entry.endOffset);
      expect(entry.endOffset).toBeLessThanOrEqual(-8);
      expect(entry.returnedOffset ?? entry.endOffset).toBeLessThanOrEqual(-8);
      expect(entry.returnedOffset ?? entry.endOffset).toBeGreaterThanOrEqual(
        entry.startOffset,
      );

      const owner = entry.item.ownerEmail && people.get(entry.item.ownerEmail);
      if (entry.item.ownerEmail !== null) {
        expect(owner).toBeDefined();
        expect(owner && owner.status).toBe(
          entry.kind === "owner-suspended" ? "suspended" : "active",
        );
      }
      if (entry.borrowerEmail !== null) {
        expect(people.get(entry.borrowerEmail)?.status).toBe("active");
        expect(entry.borrowerEmail).not.toBe(entry.item.ownerEmail);
      }
      if (entry.organizerEmail) {
        const organizer = people.get(entry.organizerEmail);
        expect([organizer?.role, organizer?.status]).toEqual([
          "organizer",
          "active",
        ]);
        expect([entry.item.ownerEmail, entry.borrowerEmail]).not.toContain(
          entry.organizerEmail,
        );
      }

      const maxLoanDays = isScenarioItem(entry.item)
        ? entry.item.maxLoanDays
        : seedItem(entry.item.ownerEmail, entry.item.title)?.maxLoanDays;
      expect(maxLoanDays, "a seed item or a scenario item").toBeDefined();
      expect(
        loanLengthDays(
          addDays(TODAY, entry.startOffset),
          addDays(TODAY, entry.endOffset),
        ),
      ).toBeLessThanOrEqual(maxLoanDays!);

      if (isScenarioItem(entry.item)) {
        expect(PRODUCTION_CATEGORIES).toContain(entry.item.category);
        expect(SEED_ITEMS.map(({ title }) => title)).not.toContain(
          entry.item.title,
        );
      }
    },
  );

  test("three scenario items, one of them ownerless", () => {
    const items = DEMO_SCENARIO.map(({ item }) => item).filter(isScenarioItem);
    expect(items).toHaveLength(3);
    expect(items.filter(({ ownerEmail }) => ownerEmail === null)).toHaveLength(
      1,
    );
  });
});
