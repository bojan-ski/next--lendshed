import { html } from "@/__tests__/support/prerender-html";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import ItemDetailSection from "@/components/items/ItemDetailSection";
import { getViewer } from "@/data/viewer";
import { itemPage } from "@/strings/itemPage";
import type { ViewerDTO } from "@/types/viewer";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Summary rows 3–5 on the item page (spec 25): what each viewer is offered on
// real rows. The refusal side is proven elsewhere and cited, not re-run: an
// own-item requestLoan is stale (actions/loans); retireItemAsOrganizer by a
// member is not-found (stage-a/action-enforcement) and on one's own item stale
// (stage-e/organizer-guard-matrix (a)); a non-owner's Edit page is not-found
// (stage-c/owner-guards).

const VIEWERS = ["memberA", "memberB", "organizerO", "organizerP"] as const;
const ITEMS = ["aListed", "aHidden", "aRetired", "pListed"] as const;
type ViewerKey = (typeof VIEWERS)[number];
type ItemKey = (typeof ITEMS)[number];
type Offer = "request" | "edit" | "retire";

const ITEM_FACTS: Record<
  ItemKey,
  { owner: ViewerKey; status: "listed" | "hidden" | "retired" }
> = {
  aListed: { owner: "memberA", status: "listed" },
  aHidden: { owner: "memberA", status: "hidden" },
  aRetired: { owner: "memberA", status: "retired" },
  pListed: { owner: "organizerP", status: "listed" },
};

const isOrganizer = (viewer: ViewerKey) => viewer.startsWith("organizer");

// Page 7's scope: Listed (owner active) for everyone, any state for the owner.
// In scope: request ⇔ not own; edit ⇔ own ∧ not retired; retire ⇔ organizer ∧
// not own (OQ-19, OQ-21).
function oracle(viewer: ViewerKey, item: ItemKey): Offer[] | "not-found" {
  const { owner, status } = ITEM_FACTS[item];
  const own = owner === viewer;
  if (!own && status !== "listed") return "not-found";
  const offers: Offer[] = [];
  if (!own) offers.push("request");
  if (own && status !== "retired") offers.push("edit");
  if (isOrganizer(viewer) && !own) offers.push("retire");
  return offers;
}

const scope = createTestScope();
const viewers = {} as Record<ViewerKey, ViewerDTO>;
const items = {} as Record<ItemKey, string>;

beforeAll(async () => {
  await assertMigrated();
  for (const key of VIEWERS) {
    const role = isOrganizer(key) ? "organizer" : "member";
    const { id } = await scope.createTestUser({
      role,
      contactDetails: "Phone",
    });
    viewers[key] = { id, displayName: "Mira K.", initials: "MK", role };
  }
  for (const key of ITEMS) {
    const { owner, status } = ITEM_FACTS[key];
    const { id } = await scope.createItem({
      ownerId: viewers[owner].id,
      status,
      title: `${scope.tag} ${key}`,
      photo: status !== "retired",
    });
    items[key] = id;
  }
});
afterAll(() => scope.cleanup());

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

// The component that renders each offer: RequestCard's RequestLoanForm posts
// itemId, ItemDetailSection links to Edit, OrganizerRetireCard has the heading.
const OFFER_SOURCE: Record<Offer, string> = {
  request: "RequestCard",
  edit: "ItemDetailSection",
  retire: "OrganizerRetireCard",
};

function offersIn(page: string, itemId: string): Offer[] {
  const offers: Offer[] = [];
  if (page.includes(`name="itemId" value="${itemId}"`)) offers.push("request");
  if (page.includes(`href="/my/items/${itemId}/edit"`)) offers.push("edit");
  if (page.includes(itemPage.retireHeading)) offers.push("retire");
  return offers;
}

async function rendered(viewer: ViewerKey, item: ItemKey) {
  vi.mocked(getViewer).mockResolvedValue(viewers[viewer]);
  const params = Promise.resolve({ id: items[item] });
  try {
    return offersIn(
      await html(await ItemDetailSection({ params })),
      items[item],
    );
  } catch (error) {
    if ((error as { digest?: string }).digest === NOT_FOUND) return "not-found";
    throw error;
  }
}

const CELLS = VIEWERS.flatMap((viewer) =>
  ITEMS.map((item) => ({ viewer, item })),
);

describe("item page offers", () => {
  test("4 viewers × 4 items = 16 cells", () => {
    expect(CELLS).toHaveLength(16);
  });

  test("the oracle's fixed points: P on P's item edits, never retires; A on A's retired item gets nothing", () => {
    expect(oracle("organizerP", "pListed")).toEqual(["edit"]);
    expect(oracle("memberA", "aRetired")).toEqual([]);
  });

  test.each(CELLS)("$viewer on $item", async ({ viewer, item }) => {
    const expected = oracle(viewer, item);
    const sources =
      expected === "not-found"
        ? "not-found"
        : expected.map((offer) => OFFER_SOURCE[offer]).join(", ");
    expect(await rendered(viewer, item), sources).toEqual(expected);
  });
});
