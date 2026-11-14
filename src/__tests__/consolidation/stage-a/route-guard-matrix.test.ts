import { isRedirectError } from "next/dist/client/components/redirect-error";
import { NextRequest } from "next/server";
import { createElement, isValidElement, Suspense, type ReactNode } from "react";
import { readSource, sourceFiles } from "@/__tests__/support/import-graph";
import { mockNextRequest } from "@/__tests__/support/next-request";
import { routePattern, routeUrl } from "@/__tests__/support/routeParams";
import AdminLayout from "@/app/(app)/admin/layout";
import AppLayout from "@/app/(app)/layout";
import AdminMenu from "@/components/admin/AdminMenu";
import OrganizerGate from "@/components/admin/OrganizerGate";
import ViewerGate from "@/components/auth/ViewerGate";
import { getViewer } from "@/data/viewer";
import { PATH_HEADER, safeNextPath } from "@/lib/auth/safe-next";
import { proxy } from "@/proxy";
import type { ViewerDTO } from "@/types/viewer";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);

type Guard = "none" | "viewerGate" | "requireOrganizer";

// The layouts that guard a route group, and the call each must contain. A page is
// classified by the nearest of these above it; a page under none of them fails.
const GUARDING_LAYOUTS: Record<
  string,
  { guard: Guard; marker: string | null }
> = {
  "src/app/(public)/layout.tsx": { guard: "none", marker: null },
  "src/app/(app)/layout.tsx": { guard: "viewerGate", marker: "<ViewerGate>" },
  "src/app/(app)/admin/layout.tsx": {
    guard: "requireOrganizer",
    marker: "<OrganizerGate>",
  },
};

const PAGE_COUNT = 20;
const ORIGIN = "http://localhost:3000";
const SEARCH = "?probe=1";

// Every guarding layout above the page, nearest first.
function guardChain(pageFile: string, layouts: Iterable<string>): Guard[] {
  const known = new Set(layouts);
  const chain: Guard[] = [];
  let dir = pageFile.slice(0, pageFile.lastIndexOf("/"));
  while (dir.startsWith("src/app")) {
    const layout = `${dir}/layout.tsx`;
    if (known.has(layout) && layout in GUARDING_LAYOUTS) {
      chain.push(GUARDING_LAYOUTS[layout].guard);
    }
    dir = dir.slice(0, dir.lastIndexOf("/"));
  }
  if (chain.length === 0) {
    throw new Error(`${pageFile} sits under no guarding layout`);
  }
  return chain;
}

const pageFiles = sourceFiles("src/app/**/page.tsx");
const layoutFiles = sourceFiles("src/app/**/layout.tsx");

const rows = pageFiles.map((file) => {
  const pattern = routePattern(file);
  const chain = guardChain(file, layoutFiles);
  return { file, pattern, url: routeUrl(pattern), chain, guard: chain[0] };
});

const member: ViewerDTO = {
  id: "u1",
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
};
const organizer: ViewerDTO = { ...member, role: "organizer" };

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

function redirectTargetOf(error: unknown): string {
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

function nextOf(location: string): string | null {
  return new URL(location, ORIGIN).searchParams.get("next");
}

const children: ReactNode = createElement("p", null, "page content");

// Every place `target` occurs in an (unrendered) element tree, as the list of
// element types above it. Walks every prop, so a slot like `header` counts too.
function ancestorsOf(node: unknown, target: ReactNode, above: unknown[] = []) {
  if (node === target) return [above];
  if (Array.isArray(node)) {
    return node.flatMap((child): unknown[][] =>
      ancestorsOf(child, target, above),
    );
  }
  if (!isValidElement(node)) return [];
  const props = node.props as Record<string, unknown>;
  return Object.values(props).flatMap((value): unknown[][] =>
    ancestorsOf(value, target, [...above, node.type]),
  );
}

describe("route-guard matrix — derivation", () => {
  test(`finds the ${PAGE_COUNT} pages`, () => {
    expect(pageFiles).toHaveLength(PAGE_COUNT);
  });

  test("(app)/layout.tsx renders page content only inside ViewerGate", () => {
    const page = createElement("p", null, "page content");
    const paths = ancestorsOf(AppLayout({ children: page }), page);
    expect(paths.length).toBeGreaterThan(0);
    for (const ancestors of paths) expect(ancestors).toContain(ViewerGate);
  });

  test("each guarding layout contains its guard", () => {
    for (const [layout, { marker }] of Object.entries(GUARDING_LAYOUTS)) {
      if (marker) expect(readSource(layout), layout).toContain(marker);
    }
  });

  test("an unmapped dynamic segment fails the derivation, naming it", () => {
    const synthetic = "src/app/(app)/examples/[slug]/page.tsx";
    expect(guardChain(synthetic, layoutFiles)).toEqual(["viewerGate"]);
    expect(() => routeUrl(routePattern(synthetic))).toThrow(
      "No routeParams entry for /examples/[slug] (segment [slug])",
    );
    expect(() => routeUrl("/docs/[[...slug]]")).toThrow("[[...slug]]");
  });

  test("a page under no guarding layout fails the derivation", () => {
    expect(() => guardChain("src/app/(other)/x/page.tsx", layoutFiles)).toThrow(
      "sits under no guarding layout",
    );
  });
});

describe.each(rows)("$pattern ($guard)", ({ url, chain, guard }) => {
  const path = url + SEARCH;

  test("guest without a cookie: the proxy outcome", () => {
    const response = proxy(new NextRequest(`${ORIGIN}${path}`));
    if (guard === "none") {
      expect(response.headers.get("x-middleware-next")).toBe("1");
      return;
    }
    expect(response.status).toBe(307);
    const location = response.headers.get("location")!;
    expect(new URL(location).pathname).toBe("/login");
    expect(nextOf(location)).toBe(safeNextPath(path));
  });

  if (guard === "none") return;

  test("guest with a stale cookie: ViewerGate redirects with a validated next", async () => {
    const response = proxy(
      new NextRequest(`${ORIGIN}${path}`, {
        headers: { cookie: "better-auth.session_token=stale.sig" },
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
    const forwarded = response.headers.get(
      `x-middleware-request-${PATH_HEADER}`,
    );
    expect(forwarded).toBe(path);

    vi.mocked(getViewer).mockResolvedValue(null);
    mockNextRequest({ path: forwarded! });
    const target = redirectTargetOf(
      await thrownBy(ViewerGate({ children }) as Promise<unknown>),
    );
    expect(new URL(target, ORIGIN).pathname).toBe("/login");
    expect(nextOf(target)).toBe(safeNextPath(path));
  });

  test.each([
    ["member", member],
    ["organizer", organizer],
  ])("%s passes ViewerGate", async (_role, viewer) => {
    vi.mocked(getViewer).mockResolvedValue(viewer);
    mockNextRequest({ path });
    await expect(ViewerGate({ children })).resolves.toBe(children);
  });

  if (!chain.includes("requireOrganizer")) return;

  test("member under (app)/admin: not-found", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    const error = await thrownBy(OrganizerGate({ children }));
    expect((error as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });
});

// The admin layout and its gate: each outcome, whatever page sits below it.
// The guard sits behind the layout's Suspense boundary (a top-level session
// read in a layout blocks instant navigation), with the menu inside it.
describe("(app)/admin/layout.tsx", () => {
  // Every element type on the way down to one of the given type.
  function typePaths(node: unknown, type: unknown, above: unknown[] = []) {
    if (Array.isArray(node)) {
      return node.flatMap((child): unknown[][] =>
        typePaths(child, type, above),
      );
    }
    if (!isValidElement(node)) return [];
    if (node.type === type) return [above];
    const props = node.props as Record<string, unknown>;
    return Object.values(props).flatMap((value): unknown[][] =>
      typePaths(value, type, [...above, node.type]),
    );
  }

  test("renders the page and the admin menu only inside OrganizerGate, inside Suspense", () => {
    const tree = AdminLayout({ children });
    const pagePaths = ancestorsOf(tree, children);
    const menuPaths = typePaths(tree, AdminMenu);
    expect(pagePaths).toHaveLength(1);
    expect(menuPaths).toHaveLength(1);
    for (const ancestors of [...pagePaths, ...menuPaths]) {
      expect(ancestors).toContain(OrganizerGate);
      expect(ancestors.indexOf(Suspense)).toBeLessThan(
        ancestors.indexOf(OrganizerGate),
      );
      expect(ancestors.indexOf(Suspense)).toBeGreaterThanOrEqual(0);
    }
  });

  test("no viewer: OrganizerGate redirects to /login", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expect(redirectTargetOf(await thrownBy(OrganizerGate({ children })))).toBe(
      "/login",
    );
  });

  test("member: OrganizerGate is not-found", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    const error = await thrownBy(OrganizerGate({ children }));
    expect(isRedirectError(error)).toBe(false);
    expect((error as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });

  test("organizer: OrganizerGate renders its children", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    await expect(OrganizerGate({ children })).resolves.toBe(children);
  });
});
