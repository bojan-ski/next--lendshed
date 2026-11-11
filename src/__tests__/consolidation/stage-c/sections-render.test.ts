import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createElement, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import BrowseSection from "@/components/browse/BrowseSection";
import ItemDetailSection from "@/components/items/ItemDetailSection";
import MemberProfileSection from "@/components/profiles/MemberProfileSection";
import {
  getBrowseItems,
  getItemForViewer,
  getMemberProfile,
} from "@/data/browse";
import { getCategories } from "@/data/categories";
import { getViewer } from "@/data/viewer";
import { communityToday } from "@/lib/dates/dates";
import { env } from "@/lib/env/server";
import { t } from "@/lib/text/interpolate";
import { home } from "@/strings/home";
import { itemPage } from "@/strings/itemPage";
import { photos } from "@/strings/photos";
import { profile } from "@/strings/profile";
import { status } from "@/strings/status";
import type { BrowsePageDTO, ItemCardDTO, ItemDetailDTO } from "@/types/item";
import type { ViewerDTO } from "@/types/viewer";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/data/categories", () => ({ getCategories: vi.fn() }));
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
  needsActionCount: 0,
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

  test("another member's item: owner link, details, no own-item line or Edit", async () => {
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
    expect(page).toContain("Two batteries");
    expect(page).toContain(t(itemPage.pickup, { notes: "Back gate" }));
    expect(page).toContain(itemPage.lendsForOne);
    expect(page).toContain(itemPage.nothingBooked);
    expect(page).not.toContain(itemPage.ownItem);
    expect(page).not.toContain(`href="/my/items/item-1/edit"`);
    expect(page).not.toContain(status.item.listed);
    expect(page).not.toContain("<form");
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
    expect(page).toContain(profile.emptyHeading);
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
