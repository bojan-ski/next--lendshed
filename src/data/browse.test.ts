import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import type { BrowseQuery } from "@/lib/schemas/browse";
import {
  getBrowseItems,
  getItemForViewer,
  getMemberProfile,
  isVisibleItem,
} from "./browse";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const TODAY = "2030-06-15";
let viewerId: string;
let ownerId: string;
let borrowerId: string;

beforeAll(async () => {
  await assertMigrated();
  [viewerId, ownerId, borrowerId] = await Promise.all(
    ["Vera N.", "Olga M.", "Ana P."].map(async (name) => {
      const { id } = await scope.createTestUser({ name });
      return id;
    }),
  );
  await db.user.update({ where: { id: ownerId }, data: { area: "north end" } });
});
afterAll(() => scope.cleanup());

// Every browse query is pinned to a scope category, so seed items never count.
// Names are unique, so a label used twice gets a counter.
let categories = 0;
async function category(label: string) {
  return (await scope.createCategory(`${label}${++categories}`)).id;
}

async function item(
  categoryId: string,
  {
    owner = ownerId,
    status = "listed",
    title = "Ladder",
    description,
    listedAt,
  }: {
    owner?: string | null;
    status?: ItemStatus;
    title?: string;
    description?: string;
    listedAt?: Date;
  } = {},
) {
  const { id } = await scope.createItem({
    ownerId: owner,
    categoryId,
    status,
    title,
  });
  if (description !== undefined || listedAt) {
    await db.item.update({
      where: { id },
      data: { description, ...(listedAt && { listedAt }) },
    });
  }
  return id;
}

const loan = (
  itemId: string,
  status: LoanStatus,
  startDate: string,
  endDate: string,
  borrower = borrowerId,
) =>
  scope.createLoan({
    itemId,
    borrowerId: borrower,
    status,
    startDate,
    endDate,
  });

const query = (overrides: Partial<BrowseQuery>): BrowseQuery => ({
  q: "",
  category: null,
  page: 1,
  ...overrides,
});

const browseIds = async (overrides: Partial<BrowseQuery>) =>
  (await getBrowseItems(viewerId, query(overrides), TODAY)).items.map(
    ({ id }) => id,
  );

const viewer = { id: "", role: "member" as const };
const as = (id: string, role: "member" | "organizer" = "member") => ({
  ...viewer,
  id,
  role,
});

describe("getBrowseItems scope", () => {
  test("only listed items of active owners other than the viewer", async () => {
    const categoryId = await category("Scope");
    const suspended = (await scope.createTestUser({ status: "suspended" })).id;
    const visible = await item(categoryId);
    await item(categoryId, { status: "hidden" });
    await item(categoryId, { status: "retired" });
    await item(categoryId, { owner: suspended });
    await item(categoryId, { owner: viewerId });
    await item(categoryId, { owner: null });

    expect(await browseIds({ category: categoryId })).toEqual([visible]);
  });
});

describe("getBrowseItems search", () => {
  test("matches the title or the description, ignoring case", async () => {
    const categoryId = await category("Search");
    const byTitle = await item(categoryId, { title: "Cordless DRILL" });
    const byDescription = await item(categoryId, {
      title: "Bits",
      description: "Fits any Drill chuck",
    });
    await item(categoryId, { title: "Ladder", description: "Tall" });

    expect(
      (await browseIds({ category: categoryId, q: "dRiLl" })).sort(),
    ).toEqual([byTitle, byDescription].sort());
  });

  test("%, _ and \\ match only themselves", async () => {
    const categoryId = await category("Literal");
    const percent = await item(categoryId, { title: "50% off" });
    await item(categoryId, { title: "5000 off" });
    const underscore = await item(categoryId, { title: "a_b" });
    await item(categoryId, { title: "axb" });
    const backslash = await item(categoryId, { title: "back\\slash" });
    await item(categoryId, { title: "backslash" });

    expect(await browseIds({ category: categoryId, q: "50%" })).toEqual([
      percent,
    ]);
    expect(await browseIds({ category: categoryId, q: "a_b" })).toEqual([
      underscore,
    ]);
    expect(await browseIds({ category: categoryId, q: "\\" })).toEqual([
      backslash,
    ]);
  });

  test("a category filter keeps only that category; null keeps all", async () => {
    const [kitchen, garden] = await Promise.all([
      category("Kitchen"),
      category("Garden"),
    ]);
    const term = `${scope.tag}-cat`;
    const pan = await item(kitchen, { title: `${term} pan` });
    const rake = await item(garden, { title: `${term} rake` });

    expect(await browseIds({ q: term, category: kitchen })).toEqual([pan]);
    expect((await browseIds({ q: term })).sort()).toEqual([pan, rake].sort());
  });
});

describe("getBrowseItems order and paging", () => {
  let categoryId: string;
  let newestFirst: string[];

  beforeAll(async () => {
    categoryId = await category("Paging");
    const base = Date.UTC(2030, 0, 1);
    const ids = await Promise.all(
      Array.from({ length: 30 }, (_, n) =>
        item(categoryId, {
          title: `Item ${n}`,
          listedAt: new Date(base + n * 60_000),
        }),
      ),
    );
    newestFirst = [...ids].reverse();
  });

  test("30 items: page 1 has 24 newest first, page 2 the last 6", async () => {
    const first = await getBrowseItems(
      viewerId,
      query({ category: categoryId }),
      TODAY,
    );
    const second = await getBrowseItems(
      viewerId,
      query({ category: categoryId, page: 2 }),
      TODAY,
    );

    expect(first.items.map(({ id }) => id)).toEqual(newestFirst.slice(0, 24));
    expect(first).toMatchObject({ page: 1, hasPrevious: false, hasNext: true });
    expect(second.items.map(({ id }) => id)).toEqual(newestFirst.slice(24));
    expect(second).toMatchObject({
      page: 2,
      hasPrevious: true,
      hasNext: false,
    });
  });

  test("a page past the end is empty with no next page", async () => {
    const page = await getBrowseItems(
      viewerId,
      query({ category: categoryId, page: 3 }),
      TODAY,
    );
    expect(page).toEqual({
      items: [],
      page: 3,
      hasPrevious: true,
      hasNext: false,
    });
  });

  test("the same listedAt falls back to id, descending", async () => {
    const tie = await category("Tie");
    const listedAt = new Date(Date.UTC(2030, 0, 1));
    const ids = await Promise.all([
      item(tie, { listedAt }),
      item(tie, { listedAt }),
    ]);
    expect(await browseIds({ category: tie })).toEqual(
      [...ids].sort().reverse(),
    );
  });

  // Every listing write sets listedAt, but nothing in the database enforces it;
  // a listed row without one must not jump to the top (12a, contract-auditor).
  test("a listed item without listedAt sorts last", async () => {
    const gap = await category("Gap");
    const dated = await item(gap, { listedAt: new Date(Date.UTC(2020, 0, 1)) });
    const undated = await item(gap);
    await db.item.update({ where: { id: undated }, data: { listedAt: null } });
    expect(await browseIds({ category: gap })).toEqual([dated, undated]);
  });
});

describe("Free today", () => {
  test.each<[string, [LoanStatus, string, string] | null, boolean]>([
    ["no loans", null, true],
    [
      "a requested loan covering today",
      ["requested", TODAY, "2030-06-17"],
      true,
    ],
    [
      "an approved loan covering today",
      ["approved", "2030-06-14", "2030-06-16"],
      false,
    ],
    [
      "an approved loan starting tomorrow",
      ["approved", "2030-06-16", "2030-06-18"],
      true,
    ],
    [
      "an out loan ending in the future",
      ["out", "2030-06-10", "2030-06-20"],
      false,
    ],
    [
      "an overdue out loan (ended yesterday)",
      ["out", "2030-06-10", "2030-06-14"],
      false,
    ],
    [
      "a returned loan covering today",
      ["returned", "2030-06-14", "2030-06-16"],
      true,
    ],
  ])("%s → %s", async (_label, row, free) => {
    const categoryId = await category("Free");
    const id = await item(categoryId);
    if (row) await loan(id, ...row);

    const [card] = (
      await getBrowseItems(viewerId, query({ category: categoryId }), TODAY)
    ).items;

    expect(card).toMatchObject({ id, freeToday: free });
  });
});

describe("getItemForViewer scope", () => {
  test("a visible item is shown, not as own", async () => {
    const id = await item(await category("Detail"), {
      title: "Drill",
      description: "Line one\nLine two",
    });
    const detail = await getItemForViewer(as(viewerId), id, TODAY);
    expect(detail).toMatchObject({
      id,
      title: "Drill",
      description: "Line one\nLine two",
      condition: "good",
      maxLoanDays: 7,
      pickupNotes: null,
      status: "listed",
      ownerName: "Olga M.",
      ownerArea: "north end",
      owner: { id: ownerId, displayName: "Olga M.", area: "north end" },
      isOwn: false,
      viewerCanRetireAsOrganizer: false,
    });
  });

  test.each<ItemStatus>(["hidden", "retired"])(
    "the owner sees their own %s item",
    async (status) => {
      const id = await item(await category("Own"), { owner: viewerId, status });
      expect(await getItemForViewer(as(viewerId), id, TODAY)).toMatchObject({
        id,
        status,
        isOwn: true,
        freeToday: false,
      });
    },
  );

  test("hidden, retired, suspended-owner, owner-less and unknown → null", async () => {
    const categoryId = await category("Hidden");
    const suspended = (await scope.createTestUser({ status: "suspended" })).id;
    const ids = await Promise.all([
      item(categoryId, { status: "hidden" }),
      item(categoryId, { status: "retired" }),
      item(categoryId, { owner: suspended }),
      item(categoryId, { owner: null }),
    ]);
    for (const id of [...ids, `${scope.tag}-missing`]) {
      expect(await getItemForViewer(as(viewerId), id, TODAY)).toBeNull();
    }
  });

  // The loan page's item link (toLoanDetailDTO's viewable) reads the row
  // predicate; it must name exactly the items this page shows a non-owner.
  test("isVisibleItem agrees with getItemForViewer on every state and owner", async () => {
    const categoryId = await category("Agree");
    const suspended = (await scope.createTestUser({ status: "suspended" })).id;
    const cases = await Promise.all(
      (["listed", "hidden", "retired"] as const).flatMap((status) =>
        [ownerId, suspended, null].map(async (owner) => {
          const id = await item(categoryId, { owner, status });
          const row = await db.item.findUniqueOrThrow({
            where: { id },
            select: { status: true, owner: { select: { status: true } } },
          });
          const shown = await getItemForViewer(as(viewerId), id, TODAY);
          return { visible: isVisibleItem(row), shown: shown !== null };
        }),
      ),
    );
    for (const { visible, shown } of cases) expect(visible).toBe(shown);
    expect(cases.filter(({ shown }) => shown)).toHaveLength(1);
  });

  test("an organizer gets no extra visibility", async () => {
    const organizer = (await scope.createTestUser({ role: "organizer" })).id;
    const id = await item(await category("Org"), { status: "hidden" });
    expect(
      await getItemForViewer(as(organizer, "organizer"), id, TODAY),
    ).toBeNull();
  });
});

describe("bookedRanges", () => {
  test("blocking loans only, still-out first, then by start date", async () => {
    const id = await item(await category("Booked"));
    await loan(id, "approved", "2030-06-20", "2030-06-22");
    await loan(id, "approved", "2030-06-13", TODAY);
    await loan(id, "out", "2030-06-01", "2030-06-05");
    await loan(id, "requested", "2030-06-25", "2030-06-26");
    await loan(id, "returned", "2030-05-01", "2030-05-03");
    await loan(id, "declined", "2030-06-25", "2030-06-26");
    await loan(id, "cancelled", "2030-06-25", "2030-06-26");

    const detail = await getItemForViewer(as(viewerId), id, TODAY);

    expect(detail?.bookedRanges).toEqual([
      { startDate: "2030-06-01", endDate: "2030-06-05", stillOut: true },
      { startDate: "2030-06-13", endDate: TODAY, stillOut: false },
      { startDate: "2030-06-20", endDate: "2030-06-22", stillOut: false },
    ]);
  });

  test("an approved loan that ended yesterday is not booked", async () => {
    const id = await item(await category("Lapsed"));
    await loan(id, "approved", "2030-06-12", "2030-06-14");
    expect(
      (await getItemForViewer(as(viewerId), id, TODAY))?.bookedRanges,
    ).toEqual([]);
  });
});

describe("viewerCanRequest", () => {
  async function requester(contactDetails: string | null = "Call 555") {
    return (await scope.createTestUser({ contactDetails })).id;
  }

  async function openRequests(borrower: string, count: number) {
    const categoryId = await category("Elsewhere");
    for (let n = 0; n < count; n++) {
      const other = await item(categoryId);
      await loan(other, "requested", "2030-06-20", "2030-06-21", borrower);
    }
  }

  const canRequest = async (borrower: string, itemId: string) =>
    (await getItemForViewer(as(borrower), itemId, TODAY))?.viewerCanRequest;

  test("own item → false", async () => {
    const me = await requester();
    const id = await item(await category("CanOwn"), { owner: me });
    expect(await canRequest(me, id)).toBe(false);
  });

  test("no contact details → false; with them → true", async () => {
    const id = await item(await category("CanContact"));
    expect(await canRequest(await requester(null), id)).toBe(false);
    expect(await canRequest(await requester(), id)).toBe(true);
  });

  test("an open request on the item → false; an expired one → true", async () => {
    const categoryId = await category("CanOpen");
    const open = await item(categoryId);
    const expired = await item(categoryId);
    const me = await requester();
    await loan(open, "requested", "2030-06-20", "2030-06-21", me);
    await loan(expired, "requested", "2030-06-10", "2030-06-12", me);

    expect(await canRequest(me, open)).toBe(false);
    expect(await canRequest(me, expired)).toBe(true);
  });

  test("five open requests elsewhere → false; four → true", async () => {
    const id = await item(await category("CanLimit"));
    const atLimit = await requester();
    const underLimit = await requester();
    await openRequests(atLimit, 5);
    await openRequests(underLimit, 4);

    expect(await canRequest(atLimit, id)).toBe(false);
    expect(await canRequest(underLimit, id)).toBe(true);
  });

  test("an approved loan by the viewer on the item → true", async () => {
    const id = await item(await category("CanApproved"));
    const me = await requester();
    await loan(id, "approved", "2030-06-20", "2030-06-22", me);
    expect(await canRequest(me, id)).toBe(true);
  });

  const blockOf = async (borrower: string, itemId: string) => {
    const detail = await getItemForViewer(as(borrower), itemId, TODAY);
    // viewerCanRequest agrees with requestBlock in every case.
    expect(detail?.viewerCanRequest).toBe(
      !detail?.isOwn && detail?.requestBlock === null,
    );
    return detail?.requestBlock;
  };

  test("requestBlock: own item → null; free to request → null", async () => {
    const categoryId = await category("BlockNone");
    const me = await requester();
    expect(await blockOf(me, await item(categoryId, { owner: me }))).toBe(null);
    expect(await blockOf(me, await item(categoryId))).toBe(null);
  });

  test("requestBlock: no contact details → contact_details, even at both limits", async () => {
    const id = await item(await category("BlockContact"));
    const me = await requester(null);
    await loan(id, "requested", "2030-06-20", "2030-06-21", me);
    await openRequests(me, 4);
    expect(await blockOf(me, id)).toBe("contact_details");
  });

  test("requestBlock: an open request on the item → item_limit, ahead of the overall limit", async () => {
    const id = await item(await category("BlockItem"));
    const me = await requester();
    await loan(id, "requested", "2030-06-20", "2030-06-21", me);
    expect(await blockOf(me, id)).toBe("item_limit");
    await openRequests(me, 4);
    expect(await blockOf(me, id)).toBe("item_limit");
  });

  test("requestBlock: five open elsewhere → overall_limit; four → null", async () => {
    const id = await item(await category("BlockOverall"));
    const atLimit = await requester();
    const underLimit = await requester();
    await openRequests(atLimit, 5);
    await openRequests(underLimit, 4);
    expect(await blockOf(atLimit, id)).toBe("overall_limit");
    expect(await blockOf(underLimit, id)).toBe(null);
  });

  test("viewerCanRetireAsOrganizer is false for organizers too", async () => {
    const organizer = (await scope.createTestUser({ role: "organizer" })).id;
    const id = await item(await category("Retire"));
    expect(
      (await getItemForViewer(as(organizer, "organizer"), id, TODAY))
        ?.viewerCanRetireAsOrganizer,
    ).toBe(false);
  });
});

describe("getMemberProfile", () => {
  test("an active member with only their listed items, newest first", async () => {
    const member = (await scope.createTestUser({ name: "Iva R." })).id;
    const categoryId = await category("Profile");
    const older = await item(categoryId, {
      owner: member,
      listedAt: new Date(Date.UTC(2030, 0, 1)),
    });
    const newer = await item(categoryId, {
      owner: member,
      listedAt: new Date(Date.UTC(2030, 0, 2)),
    });
    await item(categoryId, { owner: member, status: "hidden" });
    await item(categoryId, { owner: member, status: "retired" });

    const profile = await getMemberProfile(member, TODAY);

    expect(profile).toMatchObject({
      id: member,
      displayName: "Iva R.",
      area: null,
    });
    expect(profile?.items.map(({ id }) => id)).toEqual([newer, older]);
  });

  test("suspended and unknown (or deleted) members → null", async () => {
    const suspended = (await scope.createTestUser({ status: "suspended" })).id;
    expect(await getMemberProfile(suspended, TODAY)).toBeNull();
    expect(await getMemberProfile(`${scope.tag}-missing`, TODAY)).toBeNull();
  });
});

describe("the wire", () => {
  test("no DTO carries ids of people, emails, contact details, photo keys or timestamps", async () => {
    const categoryId = await category("Wire");
    const id = await item(categoryId);
    await db.item.update({
      where: { id },
      data: {
        photoKey: `${scope.tag}/wire.webp`,
        photoUrl: "https://example.test/wire.webp",
        photoWidth: 1200,
        photoHeight: 900,
        photoBytes: 1000,
      },
    });
    await loan(id, "approved", "2030-06-20", "2030-06-22");

    const payloads = [
      await getBrowseItems(viewerId, query({ category: categoryId }), TODAY),
      await getItemForViewer(as(viewerId), id, TODAY),
      await getMemberProfile(ownerId, TODAY),
    ];

    for (const payload of payloads) {
      expect(JSON.stringify(payload)).not.toMatch(
        /"(ownerId|borrowerId|email|contactDetails|photoKey|photoBytes|createdAt|updatedAt|listedAt|retiredAt)"/,
      );
    }
  });
});
