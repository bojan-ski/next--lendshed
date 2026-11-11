import { isRedirectError } from "next/dist/client/components/redirect-error";
import ts from "typescript";
import {
  callsIn,
  calleeName,
  enclosingFunction,
  importedNames,
} from "@/__tests__/support/ast";
import { parseFile, sourceFiles } from "@/__tests__/support/import-graph";
import { routeParams } from "@/__tests__/support/routeParams";
import { getAdminCategories } from "@/data/categories";
import { getOpenInvitations } from "@/data/invitations";
import { getAdminMemberDetail, getAdminMembers } from "@/data/members";
import { getViewer } from "@/data/viewer";
import type { ViewerDTO } from "@/types/viewer";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
// getCategories' cacheTag/cacheLife throw outside Next's runtime.
vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
// Spied, not replaced: an organizer's call runs the real read.
vi.mock("@/data/categories", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/categories")>();
  return { ...actual, getAdminCategories: vi.fn(actual.getAdminCategories) };
});
vi.mock("@/data/invitations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/invitations")>();
  return { ...actual, getOpenInvitations: vi.fn(actual.getOpenInvitations) };
});
vi.mock("@/data/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/members")>();
  return {
    ...actual,
    getAdminMembers: vi.fn(actual.getAdminMembers),
    getAdminMemberDetail: vi.fn(actual.getAdminMemberDetail),
  };
});

vi.setConfig({ testTimeout: 30_000 });

// The admin layout's requireOrganizer() doesn't re-run on a soft navigation, so
// every admin module that reads data guards itself.
const ADMIN_FILES = [
  "src/app/(app)/admin/**/*.{ts,tsx}",
  "src/components/admin/**/*.{ts,tsx}",
  "src/components/categories/**/*.{ts,tsx}",
  "src/components/invitations/**/*.{ts,tsx}",
  "src/components/members/**/*.{ts,tsx}",
]
  .flatMap((pattern) => sourceFiles(pattern))
  .filter((file) => !/\.test\.tsx?$/.test(file));

// getCategories is not here: the item form (10) and browse (12) read it outside admin.
const ADMIN_READS = {
  getAdminCategories,
  getOpenInvitations,
  getAdminMembers,
  getAdminMemberDetail,
};

const isDataModule = (specifier: string) =>
  specifier.startsWith("@/data/") && specifier !== "@/data/viewer";

const sections = ADMIN_FILES.map((file) => {
  const source = parseFile(file);
  return { file, source, dataNames: importedNames(source, isDataModule) };
}).filter(({ dataNames }) => dataNames.size > 0);

// Each function that calls a data import, and whether it awaits
// requireOrganizer() itself before its first such call.
function unguardedCalls(
  source: ts.SourceFile,
  dataNames: Set<string>,
): string[] {
  const calls = callsIn(source);
  const byFunction = new Map<ts.Node, ts.CallExpression[]>();
  for (const call of calls) {
    const name = calleeName(call);
    if (!name || !dataNames.has(name) || !ts.isIdentifier(call.expression))
      continue;
    const fn = enclosingFunction(call);
    byFunction.set(fn, [...(byFunction.get(fn) ?? []), call]);
  }
  const unguarded: string[] = [];
  for (const [fn, dataCalls] of byFunction) {
    const firstData = Math.min(...dataCalls.map((call) => call.getStart()));
    const guarded = calls.some(
      (call) =>
        calleeName(call) === "requireOrganizer" &&
        ts.isAwaitExpression(call.parent) &&
        enclosingFunction(call) === fn &&
        call.getStart() < firstData,
    );
    if (!guarded) {
      unguarded.push(dataCalls.map((call) => call.getText()).join(", "));
    }
  }
  return unguarded;
}

describe("admin data sections — static", () => {
  test("the walk finds the admin modules that read data", () => {
    expect(sections.map(({ file }) => file).sort()).toEqual([
      "src/components/categories/CategoriesSection.tsx",
      "src/components/invitations/InvitationsSection.tsx",
      "src/components/members/MemberDetailSection.tsx",
      "src/components/members/MembersSection.tsx",
    ]);
  });

  test.each(sections)(
    "$file awaits requireOrganizer() before its first data call",
    ({ source, dataNames }) => {
      expect(unguardedCalls(source, dataNames)).toEqual([]);
    },
  );

  test("the four admin reads are imported and called only by those modules", () => {
    const sectionFiles = new Set(sections.map(({ file }) => file));
    const readNames = new Set(Object.keys(ADMIN_READS));
    const outside = sourceFiles("src/**/*.{ts,tsx}")
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) => !file.startsWith("src/data/"))
      .filter((file) => !file.startsWith("src/generated/"))
      .filter((file) => !sectionFiles.has(file))
      .filter((file) => {
        const source = parseFile(file);
        const imported = importedNames(source, (s) => s.startsWith("@/data/"));
        const called = callsIn(source).map(calleeName);
        return [...readNames].some(
          (name) => imported.has(name) || called.includes(name),
        );
      });
    expect(outside).toEqual([]);
  });

  test("the guard check catches a section that reads before (or without) its guard", () => {
    const probe = (code: string) => {
      const source = ts.createSourceFile(
        "probe.tsx",
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      return unguardedCalls(source, new Set(["getAdminMembers"]));
    };
    expect(
      probe(
        `export default async function S() { const r = await getAdminMembers(""); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `export default async function S() { const r = await getAdminMembers(""); await requireOrganizer(); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `async function guard() { await requireOrganizer(); }
         export default async function S() { await guard(); await getAdminMembers(""); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `export default async function S() { await requireOrganizer(); await getAdminMembers(""); }`,
      ),
    ).toEqual([]);
  });
});

// The props each section's page passes; a new data section fails until listed.
const SECTION_PROPS: Record<string, () => object> = {
  "src/components/categories/CategoriesSection.tsx": () => ({}),
  "src/components/invitations/InvitationsSection.tsx": () => ({}),
  "src/components/members/MembersSection.tsx": () => ({
    searchParams: Promise.resolve({}),
  }),
  "src/components/members/MemberDetailSection.tsx": () => ({
    params: Promise.resolve(routeParams["/admin/members/[id]"]),
  }),
};

const member: ViewerDTO = {
  id: "u1",
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
  needsActionCount: 0,
};
const organizer: ViewerDTO = { ...member, role: "organizer" };

type Section = (props: object) => Promise<unknown>;

async function loadSection(file: string): Promise<Section> {
  const specifier = `@/${file.replace(/^src\//, "").replace(/\.tsx$/, "")}`;
  const section = await import(/* @vite-ignore */ specifier);
  return section.default as Section;
}

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

function readsOf(dataNames: Set<string>) {
  return Object.entries(ADMIN_READS)
    .filter(([name]) => dataNames.has(name))
    .map(([, spy]) => vi.mocked(spy));
}

describe("admin data sections — runtime", () => {
  test("every section found has its page's props listed", () => {
    expect(Object.keys(SECTION_PROPS).sort()).toEqual(
      sections.map(({ file }) => file).sort(),
    );
  });

  describe.each(sections)("$file", ({ file, dataNames }) => {
    const reads = readsOf(dataNames);

    test("reads at least one admin read", () => {
      expect(reads.length).toBeGreaterThan(0);
    });

    test("a guest is redirected to /login before any read", async () => {
      vi.mocked(getViewer).mockResolvedValue(null);
      const section = await loadSection(file);
      const error = await thrownBy(section(SECTION_PROPS[file]()));
      if (!isRedirectError(error)) throw error;
      expect(error.digest.split(";")[2]).toBe("/login");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
    });

    test("a member gets not-found before any read", async () => {
      vi.mocked(getViewer).mockResolvedValue(member);
      const section = await loadSection(file);
      const error = await thrownBy(section(SECTION_PROPS[file]()));
      expect((error as { digest?: string }).digest).toBe(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
      for (const read of reads) expect(read).not.toHaveBeenCalled();
    });

    test("an organizer's call reaches the read", async () => {
      vi.mocked(getViewer).mockResolvedValue(organizer);
      const section = await loadSection(file);
      await section(SECTION_PROPS[file]()).catch((error: unknown) => {
        // Only the unknown member id may end the render, and only as not-found.
        expect((error as { digest?: string }).digest).toBe(
          "NEXT_HTTP_ERROR_FALLBACK;404",
        );
      });
      expect(reads.some((read) => read.mock.calls.length > 0)).toBe(true);
    });
  });

  test("an organizer on an unknown /admin/members/[id] gets not-found", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    const section = await loadSection(
      "src/components/members/MemberDetailSection.tsx",
    );
    const error = await thrownBy(
      section(
        SECTION_PROPS["src/components/members/MemberDetailSection.tsx"](),
      ),
    );
    expect((error as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
    expect(getAdminMemberDetail).toHaveBeenCalledWith(
      organizer.id,
      routeParams["/admin/members/[id]"].id,
    );
  });
});
