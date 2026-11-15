import { existsSync } from "node:fs";
import path from "node:path";
import type { ZodObject } from "zod";
import {
  inventoryRows,
  leadingRole,
  serverActionExports,
} from "@/__tests__/support/action-inventory";
import {
  AUTHORIZATION_SUMMARY,
  type AuthorizationEntry,
  type CellOutcome,
  cellOutcome,
  handlerFiles,
  type HandlerFile,
  LEADING_ROLE_OUTCOMES,
  routeHandlers,
  SUMMARY_COLUMNS,
  type SummaryColumn,
  type SummaryRow,
  summaryRows,
} from "@/__tests__/support/authorization-summary";
import {
  readSource,
  REPO_ROOT,
  sourceFiles,
} from "@/__tests__/support/import-graph";
import { type Guard, guardChain } from "@/__tests__/support/route-guards";
import { routePattern } from "@/__tests__/support/routeParams";

// Spec 25: the overview's Authorization Summary against the actions inventory,
// the route tree, the route handlers and the suites that prove each row. Every
// check is a function of a World, so the self-test can feed it a broken one.

type PageInfo = {
  pattern: string;
  guard: Guard;
  // Each *Section component the page renders, with its source.
  sections: Record<string, string>;
};

type World = {
  rows: SummaryRow[];
  entries: AuthorizationEntry[];
  actions: string[];
  inventory: { name: string; auth: string }[];
  pages: PageInfo[];
  handlers: HandlerFile[];
  fileExists: (file: string) => boolean;
  read: (file: string) => string;
};

const SECTION_IMPORT = /import (\w+Section) from "@\/(components\/[^"]+)";/g;

function pageInfo(file: string, layouts: string[]): PageInfo {
  const sections: Record<string, string> = {};
  for (const [, name, specifier] of readSource(file).matchAll(SECTION_IMPORT)) {
    sections[name] = readSource(`src/${specifier}.tsx`);
  }
  return {
    pattern: routePattern(file),
    guard: guardChain(file, layouts)[0],
    sections,
  };
}

function realWorld(): World {
  const layouts = sourceFiles("src/app/**/layout.tsx");
  return {
    rows: summaryRows(),
    entries: AUTHORIZATION_SUMMARY,
    actions: serverActionExports().map(({ name }) => name),
    inventory: inventoryRows(),
    pages: sourceFiles("src/app/**/page.tsx").map((file) =>
      pageInfo(file, layouts),
    ),
    handlers: handlerFiles(),
    fileExists: (file) => existsSync(path.join(REPO_ROOT, file)),
    read: (file) => readSource(file),
  };
}

const outcomes = (row: SummaryRow) =>
  Object.fromEntries(
    SUMMARY_COLUMNS.map((column) => [column, cellOutcome(row.cells[column])]),
  ) as Record<SummaryColumn, CellOutcome>;

const rowOf = (world: World, entry: AuthorizationEntry) =>
  world.rows.find((row) => row.feature === entry.feature);

const sorted = (values: Iterable<string>) => [...new Set(values)].sort();

// 1. Every row has one entry, every entry a row, every cell an outcome.
function checkTable(world: World): string[] {
  const problems: string[] = [];
  const features = world.rows.map((row) => row.feature);
  for (const row of world.rows) {
    for (const column of SUMMARY_COLUMNS) {
      try {
        cellOutcome(row.cells[column]);
      } catch (error) {
        problems.push(
          `${row.feature} (${column}): ${(error as Error).message}`,
        );
      }
    }
    if (!world.entries.some((entry) => entry.feature === row.feature)) {
      problems.push(`row without an entry: ${row.feature}`);
    }
  }
  for (const entry of world.entries) {
    if (!features.includes(entry.feature)) {
      problems.push(`entry without a row: ${entry.feature}`);
    }
  }
  return problems;
}

// 2. The entries' actions are the exported actions and the inventory's, and each
// action's leading role gives the outcomes of every row that places it.
function checkActions(world: World): string[] {
  const problems: string[] = [];
  const placed = sorted(world.entries.flatMap((entry) => entry.actions));
  const exported = sorted(world.actions);
  const inventoried = sorted(world.inventory.map(({ name }) => name));
  for (const name of exported) {
    if (!placed.includes(name)) problems.push(`unplaced action: ${name}`);
    if (!inventoried.includes(name))
      problems.push(`not in the inventory: ${name}`);
  }
  for (const name of [...placed, ...inventoried]) {
    if (!exported.includes(name))
      problems.push(`not an exported action: ${name}`);
  }
  for (const { name, auth } of world.inventory) {
    const role = leadingRole(auth);
    const expected = LEADING_ROLE_OUTCOMES[role];
    if (!expected) {
      problems.push(`${name}: unknown leading role "${role}"`);
      continue;
    }
    for (const entry of world.entries.filter((e) => e.actions.includes(name))) {
      const row = rowOf(world, entry);
      if (row && JSON.stringify(outcomes(row)) !== JSON.stringify(expected)) {
        problems.push(`${name}: "${role}" disagrees with "${entry.feature}"`);
      }
    }
  }
  return problems;
}

function guardAgrees(guard: Guard, row: Record<SummaryColumn, CellOutcome>) {
  switch (guard) {
    case "none":
      return row.guest === "allowed";
    case "viewerGate":
      return row.guest === "refused" && row.member !== "refused";
    case "requireOrganizer":
      return (
        row.guest === "refused" &&
        row.member === "refused" &&
        row.organizer === "allowed"
      );
  }
}

// 3. Every page is a whole-page surface of a row its guard agrees with; every
// section sits on a guarded page and is rendered by that page's section.
function checkPages(world: World): string[] {
  const problems: string[] = [];
  const byPattern = new Map(world.pages.map((page) => [page.pattern, page]));
  for (const page of world.pages) {
    if (!world.entries.some((entry) => entry.pages.includes(page.pattern))) {
      problems.push(`unplaced page: ${page.pattern}`);
    }
  }
  for (const entry of world.entries) {
    const row = rowOf(world, entry);
    if (!row) continue;
    const cells = outcomes(row);
    for (const pattern of entry.pages) {
      const page = byPattern.get(pattern);
      if (!page) problems.push(`${entry.feature}: no page ${pattern}`);
      else if (!guardAgrees(page.guard, cells)) {
        problems.push(
          `${pattern} (${page.guard}) disagrees with "${entry.feature}"`,
        );
      }
    }
    for (const { page: pattern, component } of entry.sections) {
      const page = byPattern.get(pattern);
      if (!page) {
        problems.push(`${entry.feature}: no page ${pattern}`);
        continue;
      }
      if (page.guard === "none" || cells.guest !== "refused") {
        problems.push(
          `${component} on ${pattern}: needs a guarded page and a guest-refused row`,
        );
      }
      const rendered = Object.values(page.sections).some((source) =>
        new RegExp(`\\b${component}\\b`).test(source),
      );
      if (!rendered)
        problems.push(`${component} is not rendered on ${pattern}`);
    }
  }
  return problems;
}

const SESSION_READS = /@\/lib\/auth\/guards|@\/data\/viewer/;

// 4. The entries' handlers are the route handlers; a guest-allowed one reads no
// session, and the cron endpoint sits on the bearer row.
function checkHandlers(world: World): string[] {
  const problems: string[] = [];
  const placed = sorted(world.entries.flatMap((entry) => entry.handlers));
  const real = sorted(world.handlers.map(({ path }) => path));
  for (const handler of real) {
    if (!placed.includes(handler))
      problems.push(`unplaced handler: ${handler}`);
  }
  for (const handler of placed) {
    if (!real.includes(handler)) problems.push(`no handler ${handler}`);
  }
  for (const entry of world.entries) {
    const row = rowOf(world, entry);
    if (!row) continue;
    const cells = outcomes(row);
    for (const handler of entry.handlers) {
      const file = world.handlers.find(({ path }) => path === handler)?.file;
      if (!file) continue;
      if (cells.guest === "allowed" && SESSION_READS.test(world.read(file))) {
        problems.push(`${handler} reads a session on a guest-allowed row`);
      }
      if (handler === "/api/cron/daily" && cells.guest !== "bearer") {
        problems.push(`${handler} is not on the bearer row`);
      }
    }
  }
  return problems;
}

// The tokens that name one of an entry's drivers.
function driverTokens(world: World, entry: AuthorizationEntry): string[] {
  const pages = entry.pages.flatMap((pattern) => [
    pattern,
    ...Object.keys(
      world.pages.find((page) => page.pattern === pattern)?.sections ?? {},
    ),
  ]);
  const handlers = entry.handlers.flatMap((handler) => {
    const file = world.handlers.find(({ path }) => path === handler)?.file;
    return file ? [handler, `./${path.basename(file, ".ts")}`] : [handler];
  });
  return [
    ...entry.actions,
    ...pages,
    ...entry.sections.map(({ component }) => component),
    ...handlers,
    ...entry.reads,
    ...(entry.actions.length > 0
      ? ["serverActionExports(", "inventoryRows("]
      : []),
    ...(entry.pages.length > 0 ? ["routePattern("] : []),
  ];
}

// 5. Every row names at least one suite; each claim's file exists and contains a
// token that is one of the row's drivers. A module token belongs to its own test.
function checkCoverage(world: World): string[] {
  const problems: string[] = [];
  for (const entry of world.entries) {
    if (entry.coveredBy.length === 0) {
      problems.push(`${entry.feature}: no coverage claim`);
    }
    const tokens = driverTokens(world, entry);
    for (const { file, token } of entry.coveredBy) {
      const claim = `${entry.feature}: ${file} → ${token}`;
      if (!world.fileExists(file)) problems.push(`${claim}: no such file`);
      else if (!world.read(file).includes(token)) {
        problems.push(`${claim}: token absent`);
      } else if (!tokens.includes(token)) {
        problems.push(`${claim}: not a driver of the row`);
      } else if (token.startsWith("./")) {
        const owner = world.handlers.find(
          (handler) =>
            entry.handlers.includes(handler.path) &&
            handler.file.replace(/\.ts$/, ".test.ts") === file,
        );
        if (!owner) problems.push(`${claim}: not the handler's own test`);
      }
    }
  }
  return problems;
}

const schemaModules = import.meta.glob<Record<string, unknown>>([
  "../../../lib/schemas/*.ts",
  "!../../../lib/schemas/*.test.ts",
]);

const TARGET_KEYS = ["id", "userId", "memberId", "ownerId", "borrowerId"];

// 6. A member (self) action's first schema takes no target id.
async function selfOnlySchemas(world: World) {
  const rows = world.inventory.filter(
    ({ auth }) => leadingRole(auth) === "member (self)",
  );
  const exports: Record<string, unknown> = {};
  for (const load of Object.values(schemaModules)) {
    Object.assign(exports, await load());
  }
  const inputs = Object.fromEntries(
    inventoryRows().map((row) => [row.name, row.input]),
  );
  return rows.map(({ name }) => {
    const schema = /`(\w+Schema)`/.exec(inputs[name] ?? "")?.[1] ?? "";
    const value = exports[schema] as ZodObject | undefined;
    return {
      action: name,
      schema,
      keys: value?.shape ? Object.keys(value.shape) : null,
    };
  });
}

const world = realWorld();

describe("authorization summary — derived results", () => {
  test("18 rows, 34 actions in 8 leading-role groups", () => {
    expect(world.rows).toHaveLength(18);
    expect(world.actions).toHaveLength(34);
    const tally = Object.keys(LEADING_ROLE_OUTCOMES).map(
      (role) =>
        world.inventory.filter(({ auth }) => leadingRole(auth) === role).length,
    );
    expect(tally).toEqual([1, 2, 3, 4, 6, 4, 1, 13]);
  });

  test("20 pages by guard 5 / 9 / 6; 3 handlers; 6 sections", () => {
    const guards = (guard: Guard) =>
      world.pages.filter((page) => page.guard === guard).length;
    expect(world.pages).toHaveLength(20);
    expect([
      guards("none"),
      guards("viewerGate"),
      guards("requireOrganizer"),
    ]).toEqual([5, 9, 6]);
    expect(routeHandlers()).toEqual([
      "/api/auth/[...all]",
      "/api/cron/daily",
      "/robots.txt",
    ]);
    const sections = world.entries.flatMap(({ sections }) =>
      sections.map(({ page, component }) => `${page} ${component}`),
    );
    expect(new Set(sections).size).toBe(6);
  });
});

describe("authorization summary — checks", () => {
  test("1 · every row has an entry, every entry a row, every cell an outcome", () => {
    expect(checkTable(world)).toEqual([]);
  });

  test("2 · every action placed; leading roles agree with the cells", () => {
    expect(checkActions(world)).toEqual([]);
  });

  test("3 · every page placed; guards agree; sections rendered on guarded pages", () => {
    expect(checkPages(world)).toEqual([]);
  });

  test("4 · every handler placed; guest handlers read no session; cron on the bearer row", () => {
    expect(checkHandlers(world)).toEqual([]);
  });

  test("5 · every coverage claim holds", () => {
    expect(checkCoverage(world)).toEqual([]);
  });

  test("6 · the 4 self-only schemas take no target id; signOut takes no input", async () => {
    const schemas = await selfOnlySchemas(world);
    expect(schemas).toHaveLength(4);
    for (const { action, schema, keys } of schemas) {
      expect(keys, `${action} → ${schema || "no schema"}`).not.toBeNull();
      expect(
        keys!.filter((key) => TARGET_KEYS.includes(key)),
        action,
      ).toEqual([]);
    }
    const signOut = world.inventory.find(({ name }) => name === "signOut");
    expect(signOut).toBeDefined();
    expect(inventoryRows().find(({ name }) => name === "signOut")?.input).toBe(
      "—",
    );
  });
});

describe("authorization summary — matcher self-test", () => {
  const withEntry = (
    feature: string,
    change: (entry: AuthorizationEntry) => AuthorizationEntry,
  ): World => ({
    ...world,
    entries: world.entries.map((entry) =>
      entry.feature === feature ? change(entry) : entry,
    ),
  });
  const itemsRow = "Create/edit/list/hide/retire/delete **own** items";
  const usageRow = "Usage panel";

  test("an unclassified cell fails, naming it", () => {
    expect(() => cellOutcome("Sometimes")).toThrow('"Sometimes"');
    const broken: World = {
      ...world,
      rows: world.rows.map((row) =>
        row.feature === usageRow
          ? { ...row, cells: { ...row.cells, member: "Sometimes" } }
          : row,
      ),
    };
    expect(checkTable(broken).join("\n")).toContain(`${usageRow} (member)`);
  });

  test("the parser reads a synthetic table and a missing entry fails", () => {
    const document = [
      "## Authorization Summary",
      "",
      "| Feature | Guest | Member | Organizer |",
      "|---|---|---|---|",
      "| Make things \\| fix things | No | Item owner | `KEY` bearer only |",
      "",
      "## Next",
    ].join("\n");
    const rows = summaryRows(document);
    expect(rows).toEqual([
      {
        feature: "Make things | fix things",
        cells: {
          guest: "No",
          member: "Item owner",
          organizer: "`KEY` bearer only",
        },
      },
    ]);
    expect(checkTable({ ...world, rows: [...world.rows, ...rows] })).toContain(
      "row without an entry: Make things | fix things",
    );
  });

  test("an unplaced action fails, naming it", () => {
    const broken = withEntry(itemsRow, (entry) => ({
      ...entry,
      actions: entry.actions.filter((name) => name !== "hideItem"),
    }));
    expect(checkActions(broken)).toContain("unplaced action: hideItem");
  });

  test("a wrong leading role fails, naming the action", () => {
    const broken: World = {
      ...world,
      inventory: world.inventory.map((row) =>
        row.name === "listItem" ? { ...row, auth: "organizer" } : row,
      ),
    };
    expect(checkActions(broken).join("\n")).toContain(
      `listItem: "organizer" disagrees with "${itemsRow}"`,
    );
    const unknown: World = {
      ...world,
      inventory: world.inventory.map((row) =>
        row.name === "listItem" ? { ...row, auth: "neighbour" } : row,
      ),
    };
    expect(checkActions(unknown)).toContain(
      'listItem: unknown leading role "neighbour"',
    );
  });

  test("a guard mismatch fails, naming the page", () => {
    const broken = withEntry(usageRow, (entry) => ({
      ...entry,
      pages: [...entry.pages, "/my/loans"],
    }));
    expect(checkPages(broken)).toContain(
      `/my/loans (viewerGate) disagrees with "${usageRow}"`,
    );
    const orphan = withEntry(usageRow, (entry) => ({
      ...entry,
      pages: entry.pages.filter((page) => page !== "/admin/usage"),
    }));
    expect(checkPages(orphan)).toContain("unplaced page: /admin/usage");
  });

  test("a section the page doesn't render fails, naming it", () => {
    const broken = withEntry("Delete a member", (entry) => ({
      ...entry,
      sections: [{ page: "/admin/members/[id]", component: "RequestCard" }],
    }));
    expect(checkPages(broken)).toContain(
      "RequestCard is not rendered on /admin/members/[id]",
    );
  });

  test("an unplaced handler fails, naming it", () => {
    const broken = withEntry("Daily job endpoint", (entry) => ({
      ...entry,
      handlers: [],
    }));
    expect(checkHandlers(broken)).toContain(
      "unplaced handler: /api/cron/daily",
    );
  });

  test("a false coverage claim fails, naming it", () => {
    const file =
      "src/__tests__/consolidation/stage-d/transition-matrix.test.ts";
    const absent = withEntry(usageRow, (entry) => ({
      ...entry,
      coveredBy: [{ file, token: "getUsage" }],
    }));
    expect(checkCoverage(absent)).toContain(
      `${usageRow}: ${file} → getUsage: token absent`,
    );
    const foreign = withEntry(usageRow, (entry) => ({
      ...entry,
      coveredBy: [{ file, token: "approveLoan" }],
    }));
    expect(checkCoverage(foreign)).toContain(
      `${usageRow}: ${file} → approveLoan: not a driver of the row`,
    );
    const missing = withEntry(usageRow, (entry) => ({
      ...entry,
      coveredBy: [{ file: "src/nowhere.test.ts", token: "getUsage" }],
    }));
    expect(checkCoverage(missing)).toContain(
      `${usageRow}: src/nowhere.test.ts → getUsage: no such file`,
    );
  });
});
