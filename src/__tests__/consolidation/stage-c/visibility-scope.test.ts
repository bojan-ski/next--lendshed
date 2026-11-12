import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import ts from "typescript";
import { calleeName, importedNames, walk } from "@/__tests__/support/ast";
import {
  importSpecifiers,
  parseFile,
  sourceFiles,
} from "@/__tests__/support/import-graph";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import ItemDetailSection from "@/components/items/ItemDetailSection";
import MemberProfileSection from "@/components/profiles/MemberProfileSection";
import {
  getBrowseItems,
  getItemForViewer,
  getMemberProfile,
} from "@/data/browse";
import { getViewer } from "@/data/viewer";
import { communityToday } from "@/lib/dates/dates";
import type { ViewerDTO } from "@/types/viewer";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// OQ-23: one scope (Listed, owner active) decides what another member can see.
// Every class outside it is absent from browse, null from the readers for a
// member and an organizer, and the same not-found through the sections.

const scope = createTestScope();
const term = `${scope.tag}vis`;
const today = communityToday();

type Fixture = {
  categoryId: string;
  owner: ViewerDTO;
  suspendedOwner: ViewerDTO;
  member: ViewerDTO;
  organizer: ViewerDTO;
  items: Record<
    "visible" | "hidden" | "retired" | "suspendedOwner" | "deletedOwner",
    string
  >;
  unknownId: string;
};
let fixture: Fixture;

const asViewer = (
  { id }: { id: string },
  role: ViewerDTO["role"] = "member",
): ViewerDTO => ({
  id,
  displayName: "Mira K.",
  initials: "MK",
  role,
  needsActionCount: 0,
});

beforeAll(async () => {
  await assertMigrated();
  const { id: categoryId } = await scope.createCategory("Visibility");
  const owner = await scope.createTestUser({ contactDetails: "Phone" });
  const suspended = await scope.createTestUser({
    status: "suspended",
    contactDetails: "Phone",
  });
  const member = await scope.createTestUser();
  const organizer = await scope.createTestUser({ role: "organizer" });
  const item = (
    ownerId: string | null,
    status: "listed" | "hidden" | "retired",
    label: string,
  ) =>
    scope
      .createItem({
        ownerId,
        categoryId,
        status,
        title: `${term} ${label}`,
        photo: status !== "retired",
      })
      .then(({ id }) => id);

  fixture = {
    categoryId,
    owner: asViewer(owner),
    suspendedOwner: asViewer(suspended),
    member: asViewer(member),
    organizer: asViewer(organizer, "organizer"),
    items: {
      visible: await item(owner.id, "listed", "visible"),
      hidden: await item(owner.id, "hidden", "hidden"),
      retired: await item(owner.id, "retired", "retired"),
      suspendedOwner: await item(suspended.id, "listed", "suspended owner"),
      // The state account deletion leaves (Item.owner SetNull, spec 09).
      deletedOwner: await item(null, "listed", "deleted owner"),
    },
    unknownId: crypto.randomUUID(),
  };
});
afterAll(() => scope.cleanup());

const NON_VISIBLE = [
  "hidden",
  "retired",
  "suspendedOwner",
  "deletedOwner",
  "unknown",
] as const;
type NonVisible = (typeof NON_VISIBLE)[number];

const idOf = (kind: NonVisible) =>
  kind === "unknown" ? fixture.unknownId : fixture.items[kind];

const params = (id: string) => Promise.resolve({ id });

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

async function html(tree: unknown): Promise<string> {
  const { prelude } = await prerender(tree as ReactNode);
  return new Response(prelude).text();
}

describe("getBrowseItems", () => {
  test.each(["member", "organizer"] as const)(
    "a %s finds the visible item only, by the run-unique term and the category",
    async (role) => {
      const page = await getBrowseItems(
        fixture[role].id,
        { q: term, category: fixture.categoryId, page: 1 },
        today,
      );
      expect(page.items.map(({ id }) => id)).toEqual([fixture.items.visible]);
    },
  );
});

describe("getItemForViewer", () => {
  test.each(["member", "organizer"] as const)(
    "a %s gets the visible item",
    async (role) => {
      const item = await getItemForViewer(
        fixture[role],
        fixture.items.visible,
        today,
      );
      expect(item?.id).toBe(fixture.items.visible);
      expect(item?.isOwn).toBe(false);
    },
  );

  describe.each(["member", "organizer"] as const)("as a %s", (role) => {
    test.each(NON_VISIBLE)("%s → null", async (kind) => {
      expect(await getItemForViewer(fixture[role], idOf(kind), today)).toBe(
        null,
      );
    });
  });

  test.each(["hidden", "retired"] as const)(
    "the owner still gets their own %s item",
    async (kind) => {
      const item = await getItemForViewer(
        fixture.owner,
        fixture.items[kind],
        today,
      );
      expect(item).toMatchObject({ id: fixture.items[kind], isOwn: true });
    },
  );
});

describe("getMemberProfile", () => {
  test("the active owner shows the visible item only", async () => {
    const profile = await getMemberProfile(fixture.owner.id, today);
    expect(profile?.items.map(({ id }) => id)).toEqual([fixture.items.visible]);
  });

  test("a suspended owner and an unknown id are null", async () => {
    expect(await getMemberProfile(fixture.suspendedOwner.id, today)).toBe(null);
    expect(await getMemberProfile(fixture.unknownId, today)).toBe(null);
  });
});

describe("ItemDetailSection", () => {
  describe.each(["member", "organizer"] as const)("as a %s", (role) => {
    beforeEach(() => {
      vi.mocked(getViewer).mockResolvedValue(fixture[role]);
    });

    test.each(NON_VISIBLE)("%s is the same not-found", async (kind) => {
      const error = await rejection(
        ItemDetailSection({ params: params(idOf(kind)) }),
      );
      expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
    });

    test("the visible item renders", async () => {
      const page = await html(
        await ItemDetailSection({ params: params(fixture.items.visible) }),
      );
      expect(page).toContain(`${term} visible`);
    });
  });

  test.each(["hidden", "retired"] as const)(
    "the owner's own %s item renders",
    async (kind) => {
      vi.mocked(getViewer).mockResolvedValue(fixture.owner);
      const page = await html(
        await ItemDetailSection({ params: params(fixture.items[kind]) }),
      );
      expect(page).toContain(`${term} ${kind}`);
    },
  );
});

describe("MemberProfileSection", () => {
  beforeEach(() => {
    vi.mocked(getViewer).mockResolvedValue(fixture.member);
  });

  test.each(["suspendedOwner", "unknown"] as const)(
    "%s is not-found",
    async (kind) => {
      const id =
        kind === "unknown" ? fixture.unknownId : fixture.suspendedOwner.id;
      const error = await rejection(
        MemberProfileSection({ params: params(id) }),
      );
      expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
    },
  );

  test("the active owner's profile lists the visible item only", async () => {
    const page = await html(
      await MemberProfileSection({ params: params(fixture.owner.id) }),
    );
    expect(page).toContain(`${term} visible`);
    for (const label of ["hidden", "retired"]) {
      expect(page).not.toContain(`${term} ${label}`);
    }
  });
});

// --- Derived: who may read items, and with whose id --------------------------

const appSources = sourceFiles("src/**/*.{ts,tsx}").filter(
  (file) =>
    !/\.test\.tsx?$/.test(file) &&
    !file.startsWith("src/__tests__/") &&
    !file.startsWith("src/generated/") &&
    !file.startsWith("src/data/"),
);

// Static and dynamic (`await import(…)`) runtime imports alike.
const importsFrom = (file: string, specifier: string) =>
  importSpecifiers(parseFile(file)).includes(specifier);

// The variables a function binds to `await requireViewer()`.
function viewerBindings(fn: ts.Node): Set<string> {
  const names = new Set<string>();
  walk(fn, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isAwaitExpression(node.initializer) &&
      ts.isCallExpression(node.initializer.expression) &&
      calleeName(node.initializer.expression) === "requireViewer"
    ) {
      names.add(node.name.text);
    }
  });
  return names;
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return undefined;
}

// Calls of an @/data/items function whose first argument is not `<v>.id`, with
// `v` bound to the same function's requireViewer() result.
function foreignOwnerCalls(file: string, source = parseFile(file)): string[] {
  const itemsFunctions = importedNames(
    source,
    (specifier) => specifier === "@/data/items",
  );
  const hits: string[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node)) return;
    const name = calleeName(node);
    if (!name || !itemsFunctions.has(name)) return;
    const fn = enclosingFunction(node);
    const first = node.arguments[0];
    const ok =
      !!fn &&
      !!first &&
      ts.isPropertyAccessExpression(first) &&
      first.name.text === "id" &&
      ts.isIdentifier(first.expression) &&
      viewerBindings(fn).has(first.expression.text);
    if (!ok) hits.push(`${file}: ${node.getText()}`);
  });
  return hits;
}

describe("the derived import rule", () => {
  const readers = appSources.filter(
    (file) => importsFrom(file, "@/data/browse"),
  );

  test("the modules reading other members' items are the three sections", () => {
    expect(readers).toEqual([
      "src/components/browse/BrowseSection.tsx",
      "src/components/items/ItemDetailSection.tsx",
      "src/components/profiles/MemberProfileSection.tsx",
    ]);
  });

  test("none of them imports from @/data/items", () => {
    expect(
      readers.filter((file) => importsFrom(file, "@/data/items")),
    ).toEqual([]);
  });

  test("the matcher accepts the viewer's id and flags anything else", () => {
    const probe = ts.createSourceFile(
      "probe.tsx",
      `import { getOwnItems, getItemForEdit } from "@/data/items";
       export async function ok() { const viewer = await requireViewer(); return getOwnItems(viewer.id, "d"); }
       export async function other(id) { const viewer = await requireViewer(); return getItemForEdit(id, "x", "d"); }
       export async function unguarded(user) { return getOwnItems(user.id, "d"); }`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    expect(foreignOwnerCalls("probe.tsx", probe)).toEqual([
      'probe.tsx: getItemForEdit(id, "x", "d")',
      'probe.tsx: getOwnItems(user.id, "d")',
    ]);
  });

  test("every @/data/items call passes the caller's own requireViewer() id", () => {
    const callers = appSources.filter(
      (file) => importsFrom(file, "@/data/items"),
    );
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.flatMap((file) => foreignOwnerCalls(file))).toEqual([]);
  });
});
