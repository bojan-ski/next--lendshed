import { html } from "@/__tests__/support/prerender-html";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import MyLoansSection from "@/components/loans/MyLoansSection";
import NeedsActionBadge from "@/components/loans/NeedsActionBadge";
import { countNeedsAction, getMyLoans } from "@/data/my-loans";
import { getViewer } from "@/data/viewer";
import type { LoanStatus } from "@/generated/prisma/enums";
import { addDays, communityToday } from "@/lib/dates/dates";
import { myLoans } from "@/strings/myLoans";
import type { ViewerDTO } from "@/types/viewer";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// The header count, both tabs' Needs you groups, the badge and the rendered
// cards are one number (Stage D exit condition), at 00:30 community time, the
// previous UTC day, in every server zone, and still after a community midnight.

const TODAY = "2030-06-15";
// Belgrade is UTC+2 in June: 22:30Z on the 14th is 00:30 on the 15th there.
const NOW = new Date("2030-06-14T22:30:00Z");
const NEXT_DAY = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);

// Every effective status: approved starting before, on and after today; out
// ending before (overdue, on the UTC date that is community yesterday), on
// (due back) and after today.
const LOANS: [LoanStatus, number, number][] = [
  ["requested", 1, 2],
  ["requested", -2, -1], // expired
  ["approved", -1, 1],
  ["approved", 0, 2],
  ["approved", 1, 3],
  ["approved", -4, -1], // lapsed
  ["out", -3, -1], // overdue
  ["out", -2, 0],
  ["out", -1, 2],
  ["returned", -6, -4],
  ["declined", 1, 2],
  ["cancelled", 1, 2],
];

const scope = createTestScope();
const viewers: Record<"one" | "other" | "ended", ViewerDTO> = {} as never;

const asViewer = (id: string): ViewerDTO => ({
  id,
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
});

beforeAll(async () => {
  await assertMigrated();
  const [one, other, ended] = await Promise.all(
    ["Vera N.", "Olga M.", "Ivo N."].map(
      async (name) =>
        (await scope.createTestUser({ name, contactDetails: "Phone" })).id,
    ),
  );
  Object.assign(viewers, {
    one: asViewer(one),
    other: asViewer(other),
    ended: asViewer(ended),
  });
  const lend = async (
    ownerId: string,
    borrowerId: string,
    [status, from, to]: [LoanStatus, number, number],
  ) => {
    const { id: itemId } = await scope.createItem({
      ownerId,
      status: "listed",
      photo: true,
    });
    await scope.createLoan({
      itemId,
      borrowerId,
      status,
      startDate: addDays(TODAY, from),
      endDate: addDays(TODAY, to),
    });
  };
  // `one` lends every case to `other` and borrows every case from them.
  await Promise.all([
    ...LOANS.map((loan) => lend(one, other, loan)),
    ...LOANS.map((loan) => lend(other, one, loan)),
    lend(ended, other, ["returned", -6, -4]),
    lend(other, ended, ["declined", 1, 2]),
    lend(other, ended, ["cancelled", 1, 2]),
  ]);
});
afterAll(() => scope.cleanup());

// The badge's number, or null when it renders nothing.
async function badge(viewer: ViewerDTO): Promise<number | null> {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  const out = await NeedsActionBadge();
  if (out === null) return null;
  const number = /aria-hidden="true"[^>]*>(\d+)<\/span>/.exec(await html(out));
  return number ? Number(number[1]) : Number.NaN;
}

// The cards under the Needs you heading on one tab; null without the heading.
async function renderedNeedsYou(
  viewer: ViewerDTO,
  tab: "borrowing" | "lending",
): Promise<number | null> {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  const page = await html(
    await MyLoansSection({ searchParams: Promise.resolve({ tab }) }),
  );
  const heading = new RegExp(`<h2[^>]*>${myLoans.groups.needs_you}</h2>`).exec(
    page,
  );
  if (!heading) return null;
  const start = heading.index;
  const group = page.slice(start, page.indexOf("</section>", start));
  return group.match(/<li>/g)?.length ?? 0;
}

async function agreement(viewer: ViewerDTO) {
  const today = communityToday();
  const [count, lending, borrowing] = await Promise.all([
    countNeedsAction(viewer.id, today),
    getMyLoans(viewer.id, "lending", today),
    getMyLoans(viewer.id, "borrowing", today),
  ]);
  const cards =
    ((await renderedNeedsYou(viewer, "lending")) ?? 0) +
    ((await renderedNeedsYou(viewer, "borrowing")) ?? 0);
  return {
    count,
    groups: lending.needs_you.length + borrowing.needs_you.length,
    badge: await badge(viewer),
    cards,
  };
}

describe.each(TEST_ZONES)("in %s", (zone) => {
  useProcessTimeZone(zone);
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("today is the community date, not the UTC one", () => {
    expect(communityToday()).toBe(TODAY);
    expect(new Date().toISOString().slice(0, 10)).toBe("2030-06-14");
  });

  test.each(["one", "other"] as const)(
    "%s: count = both tabs' needs_you = badge = rendered Needs you cards",
    async (who) => {
      const {
        count,
        groups,
        badge: shown,
        cards,
      } = await agreement(viewers[who]);
      expect(count).toBeGreaterThan(0);
      expect({ groups, badge: shown, cards }).toEqual({
        groups: count,
        badge: count,
        cards: count,
      });
    },
  );

  test("only ended loans: 0, no badge, no Needs you heading on either tab", async () => {
    const viewer = viewers.ended;
    expect(await countNeedsAction(viewer.id, communityToday())).toBe(0);
    expect(await badge(viewer)).toBeNull();
    expect(await renderedNeedsYou(viewer, "lending")).toBeNull();
    expect(await renderedNeedsYou(viewer, "borrowing")).toBeNull();
  });

  test("across a community midnight the numbers move together", async () => {
    const before = await agreement(viewers.one);
    vi.setSystemTime(NEXT_DAY);
    expect(communityToday()).toBe(addDays(TODAY, 1));
    const after = await agreement(viewers.one);
    // Tomorrow's approval becomes due to hand over: the count really moved.
    expect(after.count).not.toBe(before.count);
    expect(after).toEqual({
      count: after.count,
      groups: after.count,
      badge: after.count,
      cards: after.count,
    });
  });
});
