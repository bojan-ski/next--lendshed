import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import ts from "typescript";
import {
  parseFile,
  readSource,
  walkImports,
} from "@/__tests__/support/import-graph";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import MyLoansSection from "@/components/loans/MyLoansSection";
import { requireViewer } from "@/lib/auth/guards";
import { myLoans } from "@/strings/myLoans";

vi.mock("@/lib/auth/guards", () => ({ requireViewer: vi.fn() }));
vi.mock("@/lib/dates/request-today", () => ({
  requestToday: () => "2030-06-15",
}));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const PAGE = "src/app/(app)/my/loans/page.tsx";
const SECTION = "src/components/loans/MyLoansSection.tsx";
const CARD = "src/components/loans/LoanCard.tsx";

function nodes(source: ts.SourceFile): ts.Node[] {
  const all: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    all.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return all;
}

const tagName = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
  (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText();

// Partial Prefetching leaves URL-dependent, uncached content out of the App
// Shell: the tab is read only inside the Suspense'd section, and nothing on
// the path is cached (the reads are per member and per day).
describe("the My loans page and prefetch", () => {
  test("the page never awaits searchParams; it hands them to the section inside Suspense", () => {
    const all = nodes(parseFile(PAGE));
    expect(all.some(ts.isAwaitExpression)).toBe(false);
    const uses = all.filter(
      (node) =>
        ts.isIdentifier(node) &&
        node.text === "searchParams" &&
        !ts.isBindingElement(node.parent) &&
        !ts.isJsxAttribute(node.parent),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      const attribute = use.parent.parent;
      expect(ts.isJsxAttribute(attribute)).toBe(true);
      const element = attribute.parent.parent as ts.JsxSelfClosingElement;
      expect(tagName(element)).toBe("MyLoansSection");
      const suspense = element.parent;
      expect(ts.isJsxElement(suspense) && tagName(suspense)).toBe("Suspense");
    }
  });

  test("the section awaits searchParams itself", () => {
    expect(
      nodes(parseFile(SECTION)).some(
        (node) =>
          ts.isAwaitExpression(node) &&
          node.expression.getText() === "searchParams",
      ),
    ).toBe(true);
  });

  test("no module on the page's or the badge's path is cached", () => {
    const reached = [
      ...walkImports([
        PAGE,
        "src/components/loans/NeedsActionBadge.tsx",
      ]).files.keys(),
    ];
    expect(reached).toEqual(
      expect.arrayContaining([SECTION, "src/data/my-loans.ts", CARD]),
    );
    expect(
      reached.filter((file) => /["']use cache/.test(readSource(file))),
    ).toEqual([]);
  });

  test("a card's Open loan link keeps the default prefetch", () => {
    expect(readSource(CARD)).not.toMatch(/\bprefetch\b/);
  });
});

// Decided at the set audit: a badge click lands where the work is.
describe("the default tab (test DB)", () => {
  const scope = createTestScope();
  const TODAY = "2030-06-15";

  beforeAll(() => assertMigrated());
  afterAll(() => scope.cleanup());

  async function currentTab(
    viewerId: string,
    searchParams: Record<string, string> = {},
  ) {
    vi.mocked(requireViewer).mockResolvedValue({
      id: viewerId,
      displayName: "Mira K.",
      initials: "MK",
      role: "member",
    });
    const tree = await MyLoansSection({
      searchParams: Promise.resolve(searchParams),
    });
    const { prelude } = await prerender(tree as ReactNode);
    const page = await new Response(prelude).text();
    return /<a aria-current="page"[^>]*>([^<]*)<\/a>/.exec(page)?.[1];
  }

  // A pending request on the viewer's item (Lending needs them) and/or an
  // approved loan starting today that they borrow (Borrowing needs them).
  async function viewerWith({
    lending,
    borrowing,
  }: {
    lending: boolean;
    borrowing: boolean;
  }) {
    const viewer = (await scope.createTestUser()).id;
    const other = (await scope.createTestUser()).id;
    if (lending) {
      const { id: itemId } = await scope.createItem({ ownerId: viewer });
      await scope.createLoan({
        itemId,
        borrowerId: other,
        status: "requested",
        startDate: TODAY,
        endDate: TODAY,
      });
    }
    if (borrowing) {
      const { id: itemId } = await scope.createItem({ ownerId: other });
      await scope.createLoan({
        itemId,
        borrowerId: viewer,
        status: "approved",
        startDate: TODAY,
        endDate: TODAY,
      });
    }
    return viewer;
  }

  test.each([
    [
      "only Lending needs you → Lending",
      { lending: true, borrowing: false },
      myLoans.tabs.lending,
    ],
    [
      "only Borrowing → Borrowing",
      { lending: false, borrowing: true },
      myLoans.tabs.borrowing,
    ],
    [
      "both → Borrowing",
      { lending: true, borrowing: true },
      myLoans.tabs.borrowing,
    ],
    [
      "neither → Borrowing",
      { lending: false, borrowing: false },
      myLoans.tabs.borrowing,
    ],
  ])("%s", async (_label, needs, tab) => {
    expect(await currentTab(await viewerWith(needs))).toBe(tab);
  });

  test("an explicit ?tab= always wins", async () => {
    const viewer = await viewerWith({ lending: true, borrowing: false });
    expect(await currentTab(viewer, { tab: "borrowing" })).toBe(
      myLoans.tabs.borrowing,
    );
  });
});
