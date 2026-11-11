import ts from "typescript";
import { calleeName, walk } from "@/__tests__/support/ast";
import {
  parseFile,
  readSource,
  sourceFiles,
} from "@/__tests__/support/import-graph";

// The cached-reads registry in project-data.md is the contract. A row is live once
// its function is exported from src/data/. Each live row's function holds
// 'use cache', a cacheTag for each of its tags and cacheLife with its profile;
// every action the row names calls updateTag with each tag; and no cache API
// appears anywhere else.

type RegistryRow = {
  read: string;
  tags: string[];
  profile: string;
  revalidatedBy: string[];
};

const CACHE_CALLS = [
  "cacheTag",
  "cacheLife",
  "updateTag",
  "revalidateTag",
  "revalidatePath",
  "unstable_cache",
];

const names = (cell: string) =>
  [...cell.matchAll(/`([^`]+)`/g)].map(([, name]) => name);

// The rows of the table under "### Cached Reads (tag registry)".
function registryRows(): RegistryRow[] {
  const section =
    readSource("context/project-data.md").split(
      "### Cached Reads (tag registry)",
    )[1] ?? "";
  const rows: RegistryRow[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("### ")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    const read = /^`(\w+)`$/.exec(cells[1] ?? "")?.[1];
    if (read) {
      rows.push({
        read,
        tags: names(cells[2]),
        profile: names(cells[3])[0] ?? "",
        revalidatedBy: names(cells[4]),
      });
    }
  }
  return rows;
}

type FunctionLike = ts.FunctionLikeDeclaration & { body?: ts.Node };

// `export function f`, `export async function f` and `export const f = () => …`.
function exportedFunctions(source: ts.SourceFile): Map<string, FunctionLike> {
  const found = new Map<string, FunctionLike>();
  for (const statement of source.statements) {
    const exported = ts
      .getModifiers(statement as ts.HasModifiers)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!exported) continue;
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      found.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(d.name) &&
          d.initializer &&
          (ts.isArrowFunction(d.initializer) ||
            ts.isFunctionExpression(d.initializer))
        ) {
          found.set(d.name.text, d.initializer);
        }
      }
    }
  }
  return found;
}

// The named top-level function a node sits in, or null at module level.
function ownerName(node: ts.Node): string | null {
  let owner: string | null = null;
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      owner = current.name.text;
    } else if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      ts.isFunctionLike(current.initializer)
    ) {
      owner = current.name.text;
    }
  }
  return owner;
}

function isCacheDirective(node: ts.Node): boolean {
  return (
    ts.isExpressionStatement(node) &&
    ts.isStringLiteral(node.expression) &&
    node.expression.text.startsWith("use cache")
  );
}

function hasUseCacheDirective(fn: FunctionLike): boolean {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  const first = body.statements[0];
  return (
    !!first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use cache"
  );
}

// The string-literal first arguments of every `name(...)` call inside `node`.
function literalCallArgs(node: ts.Node, name: string): string[] {
  const args: string[] = [];
  walk(node, (child) => {
    if (!ts.isCallExpression(child) || calleeName(child) !== name) return;
    const first = child.arguments[0];
    if (first && ts.isStringLiteralLike(first)) args.push(first.text);
  });
  return args;
}

type Use = { file: string; api: string; owner: string | null };

// Every cache directive and cache-API call in a source file.
function cacheUses(file: string, source: ts.SourceFile): Use[] {
  const uses: Use[] = [];
  walk(source, (node) => {
    if (isCacheDirective(node)) {
      uses.push({ file, api: "use cache", owner: ownerName(node) });
    }
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name && CACHE_CALLS.includes(name)) {
        uses.push({ file, api: name, owner: ownerName(node) });
      }
    }
  });
  return uses;
}

const appSources = sourceFiles("src/**/*.{ts,tsx}").filter(
  (file) =>
    !file.startsWith("src/__tests__/") &&
    !file.startsWith("src/generated/") &&
    !/\.test\.tsx?$/.test(file),
);

const parsed = appSources.map((file) => ({ file, source: parseFile(file) }));

const functionsUnder = (prefix: string) =>
  new Map(
    parsed
      .filter(({ file }) => file.startsWith(prefix))
      .flatMap(({ file, source }) =>
        [...exportedFunctions(source)].map(
          ([name, fn]) => [name, { file, fn }] as const,
        ),
      ),
  );

const dataFunctions = functionsUnder("src/data/");
const actionFunctions = functionsUnder("src/actions/");

const registry = registryRows();
const live = registry.filter(({ read }) => dataFunctions.has(read));

describe("cache pairing — derivation", () => {
  test("scans the app's source files", () => {
    expect(appSources).toContain("src/proxy.ts");
    expect(dataFunctions.size).toBeGreaterThan(0);
    expect(actionFunctions.size).toBeGreaterThan(0);
  });

  test("the registry parses, every row with tags, a profile and revalidators", () => {
    expect(registry.map(({ read }) => read)).toContain("getCategories");
    for (const row of registry) {
      expect(row.tags.length).toBeGreaterThan(0);
      expect(row.profile).not.toBe("");
      expect(row.revalidatedBy.length).toBeGreaterThan(0);
    }
  });

  test("getCategories is live (spec 08)", () => {
    expect(live.map(({ read }) => read)).toEqual(["getCategories"]);
  });

  test("the probes see a directive, a misplaced call and an arrow export", () => {
    const probe = ts.createSourceFile(
      "probe.ts",
      `export async function cached() { "use cache"; cacheTag("x"); cacheLife("days"); }
       export const plain = async () => { updateTag("x"); };
       export async function late() { await 1; "use cache"; }`,
      ts.ScriptTarget.Latest,
      true,
    );
    const fns = exportedFunctions(probe);
    expect([...fns.keys()]).toEqual(["cached", "plain", "late"]);
    expect(hasUseCacheDirective(fns.get("cached")!)).toBe(true);
    expect(hasUseCacheDirective(fns.get("late")!)).toBe(false);
    expect(literalCallArgs(fns.get("cached")!, "cacheTag")).toEqual(["x"]);
    expect(
      cacheUses("probe.ts", probe).map(({ api, owner }) => `${owner}:${api}`),
    ).toEqual([
      "cached:use cache",
      "cached:cacheTag",
      "cached:cacheLife",
      "plain:updateTag",
      "late:use cache",
    ]);
  });
});

describe.each(live)("registry row $read", (row) => {
  const { fn } = dataFunctions.get(row.read)!;

  test("opens with 'use cache'", () => {
    expect(hasUseCacheDirective(fn)).toBe(true);
  });

  test("tags each of its tags and sets its profile", () => {
    expect(literalCallArgs(fn, "cacheTag").sort()).toEqual(
      [...row.tags].sort(),
    );
    expect(literalCallArgs(fn, "cacheLife")).toEqual([row.profile]);
  });

  test.each(row.revalidatedBy)(
    "%s exists and calls updateTag for each tag",
    (action) => {
      const found = actionFunctions.get(action);
      expect(
        found,
        `${action} is not exported from src/actions/`,
      ).toBeDefined();
      const tags = literalCallArgs(found!.fn, "updateTag");
      for (const tag of row.tags) expect(tags).toContain(tag);
    },
  );
});

describe("cache pairing — nothing outside the registry", () => {
  const reads = new Set(live.map(({ read }) => read));
  const revalidators = new Set(
    live.flatMap(({ revalidatedBy }) => revalidatedBy),
  );
  const allowed = (use: Use) => {
    if (!use.owner) return false;
    if (["use cache", "cacheTag", "cacheLife"].includes(use.api)) {
      return use.file.startsWith("src/data/") && reads.has(use.owner);
    }
    if (use.api === "updateTag") {
      return use.file.startsWith("src/actions/") && revalidators.has(use.owner);
    }
    return false;
  };

  test("every cache directive and cache call sits in a registry function or action", () => {
    const stray = parsed
      .flatMap(({ file, source }) => cacheUses(file, source))
      .filter((use) => !allowed(use))
      .map(({ file, api, owner }) => `${file}: ${api} in ${owner ?? "module"}`);
    expect(stray).toEqual([]);
  });

  test("updateTag only ever names a registry tag", () => {
    const tags = new Set(live.flatMap((row) => row.tags));
    const unknown = parsed.flatMap(({ file, source }) =>
      literalCallArgs(source, "updateTag")
        .filter((tag) => !tags.has(tag))
        .map((tag) => `${file}: ${tag}`),
    );
    expect(unknown).toEqual([]);
  });

  test("no one-argument revalidateTag anywhere", () => {
    const oneArgument = /revalidateTag\(\s*[^,()]+\)/;
    const hits = appSources.filter((file) =>
      oneArgument.test(readSource(file)),
    );
    expect(hits).toEqual([]);
  });
});
