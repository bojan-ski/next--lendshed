import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createElement, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import BrowseSection from "@/components/browse/BrowseSection";
import CategoriesSection from "@/components/categories/CategoriesSection";
import ItemDetailSection from "@/components/items/ItemDetailSection";
import { LOAN_HEADING_ID } from "@/components/loans/ids";
import LoanDetailSection from "@/components/loans/LoanDetailSection";
import MyLoansSection from "@/components/loans/MyLoansSection";
import MemberProfileSection from "@/components/profiles/MemberProfileSection";
import {
  getBrowseItems,
  getItemForViewer,
  getMemberProfile,
} from "@/data/browse";
import { getAdminCategories, getCategories } from "@/data/categories";
import { getLoanForViewer } from "@/data/loans";
import { getMyLoans } from "@/data/my-loans";
import { getViewer } from "@/data/viewer";
import { communityToday, formatDate, formatDateRange } from "@/lib/dates/dates";
import { env } from "@/lib/env/server";
import { t } from "@/lib/text/interpolate";
import { categories } from "@/strings/categories";
import { home } from "@/strings/home";
import { itemPage } from "@/strings/itemPage";
import { loanActions } from "@/strings/loanActions";
import { loanCard } from "@/strings/loanCard";
import { loanPage } from "@/strings/loanPage";
import { myLoans } from "@/strings/myLoans";
import { photos } from "@/strings/photos";
import { profile } from "@/strings/profile";
import { requestForm } from "@/strings/requestForm";
import { status } from "@/strings/status";
import type { BrowsePageDTO, ItemCardDTO, ItemDetailDTO } from "@/types/item";
import type { LoanCardDTO, LoanDetailDTO } from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/data/categories", () => ({
  getCategories: vi.fn(),
  getAdminCategories: vi.fn(),
}));
vi.mock("@/data/loans", () => ({ getLoanForViewer: vi.fn() }));
vi.mock("@/data/my-loans", () => ({
  getMyLoans: vi.fn(),
  countNeedsAction: vi.fn(),
}));
vi.mock("@/data/browse", () => ({
  getBrowseItems: vi.fn(),
  getItemForViewer: vi.fn(),
  getMemberProfile: vi.fn(),
}));
// next/form needs the app router; a plain GET form stands in.
vi.mock("next/form", () => ({
  default: ({ children, ...props }: { children: ReactNode }) =>
    createElement("form", { method: "get", ...props }, children),
}));

const member: ViewerDTO = {
  id: "u1",
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
};

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

async function html(tree: unknown): Promise<string> {
  const { prelude } = await prerender(tree as ReactNode);
  return (await new Response(prelude).text())
    .replace(/<!-- -->/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
}

function thrown(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

function expectLoginRedirect(error: unknown) {
  if (!isRedirectError(error)) throw error;
  expect(error.digest.split(";")[2]).toBe("/login");
}

const expectNotFound = (error: unknown) =>
  expect((error as { digest?: string }).digest).toBe(
    "NEXT_HTTP_ERROR_FALLBACK;404",
  );

const statusLine = (page: string) =>
  /<p role="status"[^>]*>([^<]*)<\/p>/.exec(page)?.[1];

const CATEGORIES = [
  { id: "cat-1", name: "Garden" },
  { id: "cat-2", name: "Kitchen" },
];

const card = (n: number): ItemCardDTO => ({
  id: `item-${n}`,
  title: `Ladder ${n}`,
  categoryName: "Garden",
  ownerName: "Ana P.",
  ownerArea: null,
  photo: null,
  freeToday: false,
});

const browsePage = (overrides: Partial<BrowsePageDTO> = {}): BrowsePageDTO => ({
  items: [card(1)],
  page: 1,
  hasPrevious: false,
  hasNext: false,
  ...overrides,
});

const browse = (searchParams: Record<string, string> = {}) =>
  BrowseSection({ searchParams: Promise.resolve(searchParams) });

// The guard is stage-b's admin-guard; these are the list's own states (12a,
// test-coverage-auditor).
describe("CategoriesSection", () => {
  const organizer: ViewerDTO = { ...member, role: "organizer" };

  test("no categories → the empty state, no table", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    vi.mocked(getAdminCategories).mockResolvedValue([]);

    const page = await html(await CategoriesSection());

    // Under the page's list h2, so an h3 (12a, a11y-static-auditor).
    expect(page).toContain(
      `<h3 class="text-xl font-bold">${categories.emptyHeading}</h3>`,
    );
    expect(page).toContain(categories.emptyBody);
    expect(page).not.toContain("<table");
  });

  test("an in-use row shows the line instead of Delete; an unused row has Delete", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    vi.mocked(getAdminCategories).mockResolvedValue([
      { id: "cat-1", name: "Garden", inUse: true },
      { id: "cat-2", name: "Kitchen", inUse: false },
    ]);

    const page = await html(await CategoriesSection());

    expect(page).toContain("<table");
    expect(page).toContain(categories.inUse);
    expect(page).not.toContain(t(categories.deleteFor, { name: "Garden" }));
    expect(page).toContain(t(categories.deleteFor, { name: "Kitchen" }));
  });
});

describe("BrowseSection", () => {
  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(getCategories).mockResolvedValue(CATEGORIES);
    vi.mocked(getBrowseItems).mockResolvedValue(browsePage());
  });

  test("a guest is redirected to /login before anything is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expectLoginRedirect(await thrown(browse()));
    expect(getBrowseItems).not.toHaveBeenCalled();
  });

  test("reads with the viewer, the parsed query and today", async () => {
    await html(await browse({ q: " drill ", page: "2" }));
    expect(getBrowseItems).toHaveBeenCalledWith(
      member.id,
      { q: "drill", category: null, page: 2 },
      communityToday(),
    );
  });

  test("an unknown category is no filter: All is current, nothing hidden", async () => {
    const page = await html(await browse({ category: "nope" }));

    expect(vi.mocked(getBrowseItems).mock.calls[0][1].category).toBeNull();
    expect(page).toMatch(/aria-current="page"[^>]*>All</);
    expect(page).not.toContain(`name="category"`);
  });

  test("a known category: its chip is current, the search carries it, the line names it", async () => {
    const page = await html(await browse({ category: "cat-2", q: "pan" }));

    expect(page).toMatch(/aria-current="page"[^>]*>Kitchen</);
    expect(page).toContain(`name="category" value="cat-2"`);
    expect(statusLine(page)).toBe(
      t(home.countOne, { count: 1, page: 1 }) +
        t(home.forSearch, { q: "pan" }) +
        t(home.inCategory, { category: "Kitchen" }),
    );
  });

  test("chips keep the search and drop the page", async () => {
    const page = await html(await browse({ q: "pan", page: "3" }));
    expect(page).toContain(`href="/?q=pan&category=cat-1"`);
    expect(page).toContain(`href="/?q=pan"`);
  });

  test("the status line counts this page's items", async () => {
    vi.mocked(getBrowseItems).mockResolvedValue(
      browsePage({ items: [card(1), card(2)] }),
    );
    const page = await html(await browse());
    expect(statusLine(page)).toBe(t(home.countOther, { count: 2, page: 1 }));
  });

  test("a middle page shows Previous and Next, keeping q and category", async () => {
    vi.mocked(getBrowseItems).mockResolvedValue(
      browsePage({ page: 2, hasPrevious: true, hasNext: true }),
    );
    const page = await html(
      await browse({ q: "pan", category: "cat-1", page: "2" }),
    );

    expect(page).toContain(`aria-label="${home.pagesLabel}"`);
    expect(page).toContain(`href="/?q=pan&category=cat-1"`);
    expect(page).toContain(`href="/?q=pan&category=cat-1&page=3"`);
    expect(page).toContain(t(home.pageLine, { page: 2 }));
  });

  test("a single page has no pager", async () => {
    const page = await html(await browse());
    expect(page).not.toContain(`aria-label="${home.pagesLabel}"`);
  });

  test.each<[string, Record<string, string>, string, string, string]>([
    [
      "nothing listed",
      {},
      home.emptyHeading,
      `href="/my/items/new"`,
      t(home.emptyBody, { community: env.COMMUNITY_NAME }),
    ],
    [
      "no matches",
      { q: "zzz" },
      home.noMatchesHeading,
      `href="/"`,
      home.noMatchesBody,
    ],
    [
      "past the end",
      { q: "pan", page: "4" },
      home.noMoreHeading,
      `href="/?q=pan"`,
      home.noMoreBody,
    ],
  ])(
    "%s: its empty state and one link, no pager",
    async (_label, params, heading, link, body) => {
      vi.mocked(getBrowseItems).mockResolvedValue(
        browsePage({
          items: [],
          page: Number(params.page ?? 1),
          hasPrevious: Number(params.page ?? 1) > 1,
        }),
      );

      const page = await html(await browse(params));

      expect(page).toContain(heading);
      expect(page).toContain(body);
      expect(page).toContain(link);
      expect(page).not.toContain(`aria-label="${home.pagesLabel}"`);
      expect(statusLine(page)).toBeDefined();
    },
  );
});

const detail = (overrides: Partial<ItemDetailDTO> = {}): ItemDetailDTO => ({
  ...card(1),
  title: "Cordless drill",
  description: "",
  condition: "good",
  maxLoanDays: 7,
  pickupNotes: null,
  status: "listed",
  owner: { id: "owner-1", displayName: "Ana P.", area: null },
  bookedRanges: [],
  isOwn: false,
  requestBlock: null,
  viewerCanRequest: true,
  viewerCanRetireAsOrganizer: false,
  ...overrides,
});

const itemParams = { params: Promise.resolve({ id: "item-1" }) };

describe("ItemDetailSection", () => {
  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(member);
  });

  test("a guest is redirected to /login before the item is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expectLoginRedirect(await thrown(ItemDetailSection(itemParams)));
    expect(getItemForViewer).not.toHaveBeenCalled();
  });

  test("outside the scope (null) is not-found", async () => {
    vi.mocked(getItemForViewer).mockResolvedValue(null);

    expectNotFound(await thrown(ItemDetailSection(itemParams)));
    expect(getItemForViewer).toHaveBeenCalledWith(
      member,
      "item-1",
      communityToday(),
    );
  });

  test("another member's item: owner link, details, the request card, no own-item line or Edit", async () => {
    vi.mocked(getItemForViewer).mockResolvedValue(
      detail({
        description: "Two batteries",
        pickupNotes: "Back gate",
        maxLoanDays: 1,
        owner: { id: "owner-1", displayName: "Ana P.", area: "Oak Lane" },
      }),
    );

    const page = await html(await ItemDetailSection(itemParams));

    expect(page).toContain(`href="/members/owner-1"`);
    expect(page).toContain(t(itemPage.ownerArea, { area: "Oak Lane" }));
    // A 44 px target whose focus ring no overflow box clips (12a, ui-reviewer).
    const link = page.lastIndexOf(
      "<a",
      page.indexOf(`href="/members/owner-1"`),
    );
    const ownerRow = page.slice(page.lastIndexOf("<p", link), link);
    expect(ownerRow).not.toMatch(/truncate|overflow/);
    expect(/^<a [^>]*class="([^"]*)"/.exec(page.slice(link))?.[1]).toContain(
      "min-h-11",
    );
    expect(page).toContain("Two batteries");
    expect(page).toContain(t(itemPage.pickup, { notes: "Back gate" }));
    expect(page).toContain(itemPage.lendsForOne);
    expect(page).toContain(itemPage.nothingBooked);
    expect(page).not.toContain(itemPage.ownItem);
    expect(page).not.toContain(`href="/my/items/item-1/edit"`);
    expect(page).not.toContain(status.item.listed);
    expect(page).toContain(requestForm.heading);
    expect(page).toContain(`name="itemId" value="item-1"`);
  });

  test("no description or pickup notes: neither line renders", async () => {
    vi.mocked(getItemForViewer).mockResolvedValue(detail());
    const page = await html(await ItemDetailSection(itemParams));
    expect(page).not.toContain(t(itemPage.pickup, { notes: "" }).trim());
    expect(page).toContain(t(itemPage.lendsForOther, { days: 7 }));
  });

  test("own listed item: status label, the own-item line and Edit", async () => {
    vi.mocked(getItemForViewer).mockResolvedValue(detail({ isOwn: true }));

    const page = await html(await ItemDetailSection(itemParams));

    expect(page).toContain(status.item.listed);
    expect(page).toContain(itemPage.ownItem);
    expect(page).toContain(`href="/my/items/item-1/edit"`);
    expect(page).not.toContain(requestForm.heading);
    expect(page).not.toContain("<form");
  });

  test("own retired item: no Edit", async () => {
    vi.mocked(getItemForViewer).mockResolvedValue(
      detail({ isOwn: true, status: "retired" }),
    );

    const page = await html(await ItemDetailSection(itemParams));

    expect(page).toContain(status.item.retired);
    expect(page).toContain(itemPage.ownItem);
    expect(page).not.toContain(`href="/my/items/item-1/edit"`);
  });

  test("a photo is the stored file, uncropped, with its alt; none → placeholder", async () => {
    const photo = { url: "/uploads/items/a.webp", width: 1200, height: 900 };
    vi.mocked(getItemForViewer).mockResolvedValueOnce(detail({ photo }));
    const withPhoto = await html(await ItemDetailSection(itemParams));

    expect(withPhoto).toContain(`src="${photo.url}"`);
    expect(withPhoto).toContain(
      `alt="${t(photos.previewAlt, { title: "Cordless drill" })}"`,
    );
    expect(withPhoto).not.toContain("object-cover");

    vi.mocked(getItemForViewer).mockResolvedValueOnce(detail());
    const without = await html(await ItemDetailSection(itemParams));
    expect(without).toContain(`data-testid="photo-placeholder"`);
  });
});

const profileParams = { params: Promise.resolve({ id: "member-1" }) };

describe("MemberProfileSection", () => {
  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(member);
  });

  test("a guest is redirected to /login before the profile is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expectLoginRedirect(await thrown(MemberProfileSection(profileParams)));
    expect(getMemberProfile).not.toHaveBeenCalled();
  });

  test("a suspended, deleted or unknown member (null) is not-found", async () => {
    vi.mocked(getMemberProfile).mockResolvedValue(null);
    expectNotFound(await thrown(MemberProfileSection(profileParams)));
    expect(getMemberProfile).toHaveBeenCalledWith("member-1", communityToday());
  });

  test("no listed items: the empty state, no button", async () => {
    vi.mocked(getMemberProfile).mockResolvedValue({
      id: "member-1",
      displayName: "Ana P.",
      area: "Oak Lane",
      items: [],
    });

    const page = await html(await MemberProfileSection(profileParams));

    expect(page).toContain("Ana P.");
    expect(page).toContain("Oak Lane");
    expect(page).toContain(
      `<h3 class="text-xl font-bold">${profile.emptyHeading}</h3>`,
    );
    expect(page.match(/<h2/g)).toHaveLength(1);
    expect(page).not.toMatch(/<a [^>]*h-12/);
  });

  test("listed items: cards with h3 titles under the h2", async () => {
    vi.mocked(getMemberProfile).mockResolvedValue({
      id: "member-1",
      displayName: "Ana P.",
      area: null,
      items: [card(1), card(2)],
    });

    const page = await html(await MemberProfileSection(profileParams));

    expect(page).toMatch(new RegExp(`<h2[^>]*>${profile.listedHeading}</h2>`));
    expect(page.match(/<h3[^>]*>Ladder \d<\/h3>/g)).toHaveLength(2);
    expect(page).not.toContain(profile.emptyHeading);
  });
});

// Spec 13: the loan page section, on mocked DTOs.
const loanDetail = (overrides: Partial<LoanDetailDTO> = {}): LoanDetailDTO => ({
  id: "loan-1",
  status: "requested",
  startDate: "2030-06-20",
  endDate: "2030-06-22",
  lengthDays: 3,
  item: {
    id: "item-1",
    title: "Step ladder",
    photo: null,
    status: "listed",
    viewable: true,
  },
  owner: { id: "owner-1", displayName: "Olga M." },
  borrower: { id: "u1", displayName: "Ana P." },
  viewerRole: "borrower",
  requestMessage: null,
  statusReason: null,
  endedBy: null,
  systemReason: null,
  returnedOn: null,
  returnedAsLent: null,
  closedByName: null,
  overlappingRequestCount: 0,
  handOverBlocked: false,
  contact: null,
  actions: [],
  ...overrides,
});

const loanParams = { params: Promise.resolve({ id: "loan-1" }) };
const names = { owner: "Olga M.", borrower: "Ana P." };
const loanPageOf = async (overrides: Partial<LoanDetailDTO> = {}) => {
  vi.mocked(getLoanForViewer).mockResolvedValue(loanDetail(overrides));
  return html(await LoanDetailSection(loanParams));
};

describe("LoanDetailSection", () => {
  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(member);
  });

  test("a guest is redirected to /login before the loan is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expectLoginRedirect(await thrown(LoanDetailSection(loanParams)));
    expect(getLoanForViewer).not.toHaveBeenCalled();
  });

  test("outside the scope (null) is not-found, with one community today", async () => {
    vi.mocked(getLoanForViewer).mockResolvedValue(null);
    expectNotFound(await thrown(LoanDetailSection(loanParams)));
    expect(getLoanForViewer).toHaveBeenCalledWith(
      member,
      "loan-1",
      communityToday(),
    );
  });

  test("the borrower: heading, status, dates line from the owner, steps, no cards", async () => {
    const today = communityToday();
    const page = await loanPageOf();

    expect(page).toMatch(/<h1[^>]*>Step ladder<\/h1>/);
    expect(page).toContain(status.loan.requested);
    expect(page).toContain(formatDateRange("2030-06-20", "2030-06-22", today));
    expect(page).toContain(t(loanPage.lengthOther, { days: 3 }));
    expect(page).toContain(
      t(loanPage.partyLine, { party: t(loanPage.party.borrower, names) }),
    );
    expect(page).toContain(`href="/items/item-1"`);
    expect(page).toContain(loanPage.nextHeading);
    expect(page).toContain(
      t(loanPage.steps.requested.borrower[0], { ...names }),
    );
    expect(page).not.toContain(loanPage.messageBorrower);
    expect(page).not.toContain(loanPage.contactNote);
  });

  test("the owner of an approved loan: the borrower's message and contact card", async () => {
    const page = await loanPageOf({
      status: "approved",
      viewerRole: "owner",
      requestMessage: "Saturday\nmorning?",
      contact: { name: "Ana P.", details: "Flat 3\nCall 555" },
    });

    expect(page).toContain(
      t(loanPage.partyLine, { party: t(loanPage.party.owner, names) }),
    );
    expect(page).toContain(t(loanPage.messageOther, { borrower: "Ana P." }));
    expect(page).toContain("Saturday\nmorning?");
    expect(page).toContain(t(loanPage.contactHeading, { name: "Ana P." }));
    expect(page).toContain("Flat 3\nCall 555");
    expect(page).toContain(loanPage.contactNote);
  });

  test("a non-party organizer: both names, third-person steps, no contact card", async () => {
    const page = await loanPageOf({ viewerRole: "organizer", status: "out" });

    expect(page).toContain(
      t(loanPage.partyLine, { party: t(loanPage.party.organizer, names) }),
    );
    expect(page).toContain(t(loanPage.steps.out.organizer[1], { ...names }));
    expect(page).not.toContain(loanPage.contactNote);
  });

  test("an item the viewer can't open is plain text, not a link", async () => {
    const page = await loanPageOf({
      item: { ...loanDetail().item, status: "retired", viewable: false },
    });
    expect(page).not.toContain(`href="/items/item-1"`);
    expect(page).toContain("Step ladder");
  });

  test("an overdue loan names the date it was due", async () => {
    const today = communityToday();
    const page = await loanPageOf({ status: "overdue" });
    expect(page).toContain(
      t(loanPage.steps.overdue.borrower[0], {
        ...names,
        due: formatDate("2030-06-22", today),
      }),
    );
  });

  test.each([
    [
      "returned, not as lent, with a reason",
      {
        status: "returned",
        returnedOn: "2030-06-21",
        returnedAsLent: "no",
        statusReason: "Handle cracked",
      },
      (today: string) => [
        t(loanPage.ended.returned, { date: formatDate("2030-06-21", today) }),
        loanPage.ended.notAsLent,
        t(loanPage.reasonQuote, { reason: "Handle cracked" }),
      ],
    ],
    [
      "declined by the system for dates taken",
      { status: "declined", endedBy: "system", systemReason: "dates_taken" },
      () => [
        t(loanPage.ended.declinedAuto, {
          reason: loanPage.reasons.dates_taken,
        }),
      ],
    ],
    [
      "cancelled by the viewing borrower",
      { status: "cancelled", endedBy: "borrower" },
      () => [t(loanPage.ended.cancelled, { actor: loanPage.you })],
    ],
    [
      "declined by the owner",
      { status: "declined", endedBy: "owner" },
      () => [t(loanPage.ended.declined, { actor: "Olga M." })],
    ],
    ["expired", { status: "expired" }, () => [loanPage.ended.expired]],
    ["lapsed", { status: "lapsed" }, () => [loanPage.ended.lapsed]],
  ] as const)(
    "%s: the ended lines, no steps",
    async (_label, overrides, lines) => {
      const page = await loanPageOf(overrides as Partial<LoanDetailDTO>);
      for (const line of lines(communityToday())) expect(page).toContain(line);
      expect(page).not.toContain("<ol");
    },
  );
});

// Spec 14: the decisions card, exactly the controls `actions` lists.
describe("LoanDetailSection — the decisions card", () => {
  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(member);
  });

  const button = (label: string) =>
    new RegExp(`<button[^>]*>${label}</button>`);

  test("no actions → no card", async () => {
    const page = await loanPageOf({ status: "declined", actions: [] });
    expect(page).not.toContain(loanActions.heading);
  });

  test("the owner on a request: the card first in the left column, Approve and Decline", async () => {
    const page = await loanPageOf({
      viewerRole: "owner",
      actions: ["approve", "decline"],
    });

    expect(page).toMatch(new RegExp(`<h2[^>]*>${loanActions.heading}</h2>`));
    expect(page.indexOf(loanActions.heading)).toBeLessThan(
      page.indexOf(loanPage.nextHeading),
    );
    expect(page).toMatch(button(loanActions.approve));
    expect(page).toMatch(button(loanActions.decline));
    expect(page).not.toContain(loanActions.overlapOne);
    expect(page).toMatch(new RegExp(`<h1[^>]*id="${LOAN_HEADING_ID}"`));
  });

  test.each([
    [1, loanActions.overlapOne],
    [2, t(loanActions.overlapOther, { count: 2 })],
  ])("%i overlapping request(s) → the matching notice", async (count, text) => {
    const page = await loanPageOf({
      viewerRole: "owner",
      actions: ["approve", "decline"],
      overlappingRequestCount: count,
    });
    expect(page).toContain(text);
  });

  test("decline alone: no Approve and no overlap notice", async () => {
    const page = await loanPageOf({
      viewerRole: "owner",
      actions: ["decline"],
      overlappingRequestCount: 1,
    });
    expect(page).toMatch(button(loanActions.decline));
    expect(page).not.toMatch(button(loanActions.approve));
    expect(page).not.toContain(loanActions.overlapOne);
  });

  test.each([
    ["requested", loanActions.cancelRequest],
    ["approved", loanActions.cancelLoan],
  ] as const)("cancel on a %s loan reads %s", async (loanStatus, label) => {
    const page = await loanPageOf({ status: loanStatus, actions: ["cancel"] });
    expect(page).toMatch(button(label));
    expect(page).not.toMatch(button(loanActions.approve));
  });
});

// Spec 15: handover and return in the same card, one accent button at most.
describe("LoanDetailSection — handover and return", () => {
  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(member);
  });

  const button = (label: string) =>
    new RegExp(`<button[^>]*>${label}</button>`);
  const accentButtons = (page: string) =>
    page.match(/<button[^>]*class="[^"]*\bbg-accent\b/g) ?? [];

  test("hand_over: Your loan, Handed over beside Cancel loan, no notice", async () => {
    const page = await loanPageOf({
      status: "approved",
      viewerRole: "owner",
      actions: ["hand_over", "cancel"],
    });

    expect(page).toMatch(
      new RegExp(`<h2[^>]*>${loanActions.headingLoan}</h2>`),
    );
    expect(page).toMatch(button(loanActions.handOver));
    expect(page).toMatch(button(loanActions.cancelLoan));
    expect(page).not.toContain(loanActions.notBack);
    expect(accentButtons(page)).toHaveLength(1);
  });

  test("handOverBlocked: the not-back notice and Cancel loan only", async () => {
    const page = await loanPageOf({
      status: "approved",
      viewerRole: "owner",
      actions: ["cancel"],
      handOverBlocked: true,
    });

    expect(page).toContain(loanActions.notBack);
    expect(page).not.toMatch(button(loanActions.handOver));
    expect(page).toMatch(button(loanActions.cancelLoan));
  });

  test.each(["out", "overdue"] as const)(
    "mark_returned on an %s loan: Is it back?, the bounded date, two unchecked answers",
    async (loanStatus) => {
      const page = await loanPageOf({
        status: loanStatus,
        viewerRole: "owner",
        actions: ["mark_returned"],
      });

      expect(page).toContain(`>${loanActions.headingReturn}</h2>`);
      expect(page).toContain(loanActions.backOn);
      const date = page.match(/<input[^>]*name="returnedOn"[^>]*>/)?.[0] ?? "";
      expect(date).toContain(`type="date"`);
      expect(date).toContain(`min="2030-06-20"`);
      expect(date).toContain(`max="${communityToday()}"`);
      expect(page).toContain(loanActions.asLentLegend);
      const radios = page.match(/<input[^>]*name="asLent"[^>]*>/g) ?? [];
      expect(radios).toHaveLength(2);
      for (const radio of radios) {
        expect(radio).not.toMatch(/\bchecked\b|\brequired\b/);
      }
      expect(page).toMatch(button(loanActions.markBack));
      expect(page).not.toMatch(button(loanActions.cancelLoan));
      expect(accentButtons(page)).toHaveLength(1);
    },
  );

  test("the borrower of an out loan: no card", async () => {
    const page = await loanPageOf({ status: "out", actions: [] });
    expect(page).not.toContain(loanActions.headingReturn);
    expect(page).not.toMatch(button(loanActions.markBack));
  });
});

// Spec 16: back to the tab the loan sits on; an organizer looking in has none.
describe("LoanDetailSection — the back link", () => {
  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(member);
  });

  test.each([
    ["owner", "/my/loans?tab=lending"],
    ["borrower", "/my/loans?tab=borrowing"],
  ] as const)(
    "the %s's link goes to %s, above the h1",
    async (viewerRole, href) => {
      const page = await loanPageOf({ viewerRole });
      const anchor = /<a [^>]*>(?:(?!<\/a>).)*<\/a>/g;
      const back = page.match(anchor)?.find((a) => a.includes(loanPage.back));
      expect(back).toContain(`href="${href}"`);
      expect(page.indexOf(loanPage.back)).toBeLessThan(page.indexOf("<h1"));
    },
  );

  test("a non-party organizer gets no back link", async () => {
    const page = await loanPageOf({ viewerRole: "organizer" });
    expect(page).not.toContain(loanPage.back);
    expect(page).not.toContain("/my/loans");
  });
});

// Spec 16: the My loans section, on mocked DTOs.
describe("MyLoansSection", () => {
  const myCard = (overrides: Partial<LoanCardDTO> = {}): LoanCardDTO => ({
    id: "loan-1",
    side: "lending",
    item: { id: "item-1", title: "Step ladder", photo: null },
    otherPartyName: "Ana P.",
    startDate: "2030-06-20",
    endDate: "2030-06-22",
    status: "requested",
    group: "needs_you",
    needsYou: "review_request",
    changed: true,
    ...overrides,
  });
  const myLoansPage = (tab: string) =>
    MyLoansSection({ searchParams: Promise.resolve({ tab }) });

  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(member);
  });

  test("a guest is redirected to /login before any loan is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expectLoginRedirect(await thrown(myLoansPage("lending")));
    expect(getMyLoans).not.toHaveBeenCalled();
  });

  test("reads the viewer's own side on one community today, and renders h2 groups over h3 cards", async () => {
    vi.mocked(getMyLoans).mockResolvedValue({
      needs_you: [myCard()],
      active: [],
      past: [
        myCard({
          id: "loan-2",
          status: "returned",
          group: "past",
          needsYou: null,
          changed: false,
        }),
      ],
    });
    const page = await html(await myLoansPage("lending"));

    expect(getMyLoans).toHaveBeenCalledWith("u1", "lending", communityToday());
    expect(page).toContain(
      `<h2 class="text-xl font-bold">${myLoans.groups.needs_you}</h2>`,
    );
    expect(page).toContain(
      `<h2 class="text-xl font-bold">${myLoans.groups.past}</h2>`,
    );
    expect(page).not.toContain(myLoans.groups.active);
    expect(page.match(/<h3 /g)).toHaveLength(2);
    expect(page).toContain(
      t(loanCard.nextStep.review_request, { name: "Ana P." }),
    );
    expect(page).toContain(loanCard.changed);
  });
});
