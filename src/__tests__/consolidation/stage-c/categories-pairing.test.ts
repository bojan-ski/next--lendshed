import ts from "typescript";
import { calleeName, importedNames, walk } from "@/__tests__/support/ast";
import {
  isUseServerModule,
  parseFile,
  readSource,
  sourceFiles,
} from "@/__tests__/support/import-graph";

// The closure around cache-pairing's registry check: every function that writes
// the `category` table is found, and only the registry's revalidators for
// `categories` reach them. "updateTag on success, never on a refusal" stays
// proven by src/actions/categories.test.ts.

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
]);
const RAW_CATEGORY_WRITE =
  /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?category"?[\s(]/i;

// `<anything>.category.<write>(…)`: a Prisma delegate write on the table.
function isCategoryWrite(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    WRITE_METHODS.has(callee.name.text) &&
    ts.isPropertyAccessExpression(callee.expression) &&
    callee.expression.name.text === "category"
  );
}

// The named top-level function a node sits in, or null at module level.
function topLevelName(node: ts.Node): string | null {
  let name: string | null = null;
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      name = current.name.text;
    } else if (
      ts.isVariableDeclaration(current) &&
      ts.isIdentifier(current.name) &&
      current.initializer &&
      ts.isFunctionLike(current.initializer)
    ) {
      name = current.name.text;
    }
  }
  return name;
}

function categoryWriters(file: string, source = parseFile(file)): string[] {
  const writers: string[] = [];
  walk(source, (node) => {
    // Raw SQL only through a tagged template ($executeRaw`…`), so UI copy
    // such as "Delete from category" never matches.
    const raw =
      ts.isTaggedTemplateExpression(node) &&
      RAW_CATEGORY_WRITE.test(node.template.getText());
    if (isCategoryWrite(node) || raw) {
      writers.push(`${file}:${topLevelName(node) ?? "module"}`);
    }
  });
  return [...new Set(writers)];
}

const isTestFile = (file: string) =>
  /\.test\.tsx?$/.test(file) || file.startsWith("src/__tests__/");

const appFiles = [
  ...sourceFiles("src/**/*.{ts,tsx}"),
  ...sourceFiles("scripts/**/*.ts"),
  ...sourceFiles("prisma/**/*.ts"),
].filter((file) => !isTestFile(file) && !file.startsWith("src/generated/"));

const writers = appFiles.flatMap((file) => categoryWriters(file));
const dataWriters = writers
  .filter((writer) => writer.startsWith("src/data/"))
  .map((writer) => writer.split(":")[1]);

// The revalidators the registry names for the `categories` tag.
function registryRevalidators(tag: string): string[] {
  const section =
    readSource("context/project-data.md").split(
      "### Cached Reads (tag registry)",
    )[1] ?? "";
  const names = (cell: string) =>
    [...cell.matchAll(/`([^`]+)`/g)].map(([, name]) => name);
  for (const line of section.split("\n")) {
    if (line.startsWith("### ")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    if (/^`\w+`$/.test(cells[1] ?? "") && names(cells[2] ?? "").includes(tag)) {
      return names(cells[4]);
    }
  }
  return [];
}

type ActionFunction = { file: string; name: string; fn: ts.Node };

// Every exported function of every "use server" module under src/actions/.
const serverActions: ActionFunction[] = sourceFiles("src/actions/**/*.ts")
  .filter((file) => !isTestFile(file))
  .flatMap((file) => {
    const source = parseFile(file);
    if (!isUseServerModule(source)) return [];
    return source.statements.flatMap((statement): ActionFunction[] => {
      const exported = ts
        .getModifiers(statement as ts.HasModifiers)
        ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (!exported) return [];
      if (ts.isFunctionDeclaration(statement) && statement.name) {
        return [{ file, name: statement.name.text, fn: statement }];
      }
      if (ts.isVariableStatement(statement)) {
        return statement.declarationList.declarations.flatMap((d) =>
          ts.isIdentifier(d.name) && d.initializer
            ? [{ file, name: d.name.text, fn: d.initializer }]
            : [],
        );
      }
      return [];
    });
  });

// Names called inside a function body.
function callsInside(fn: ts.Node): Set<string> {
  const called = new Set<string>();
  walk(fn, (node) => {
    if (ts.isCallExpression(node)) {
      const name = calleeName(node);
      if (name) called.add(name);
    }
  });
  return called;
}

function updateTagArgs(fn: ts.Node): string[] {
  const args: string[] = [];
  walk(fn, (node) => {
    if (!ts.isCallExpression(node) || calleeName(node) !== "updateTag") return;
    const first = node.arguments[0];
    if (first && ts.isStringLiteralLike(first)) args.push(first.text);
  });
  return args;
}

describe("categories pairing — the derivation", () => {
  test("the matcher sees delegate writes, raw SQL and ignores reads", () => {
    const probe = ts.createSourceFile(
      "probe.ts",
      `export async function a(tx) { await tx.category.updateMany({}); }
       export const b = async () => db.category.findMany();
       export async function c() { await db.$executeRaw\`DELETE FROM "category" WHERE id = 1\`; }
       export async function d() { await db.item.create({ data: { category: 1 } }); }`,
      ts.ScriptTarget.Latest,
      true,
    );
    expect(categoryWriters("probe.ts", probe)).toEqual([
      "probe.ts:a",
      "probe.ts:c",
    ]);
  });

  test("scans app, script and seed sources but no test file", () => {
    expect(appFiles).toContain("src/data/categories.ts");
    expect(appFiles).toContain("scripts/lib/categories.ts");
    expect(appFiles).toContain("prisma/seed/categories.ts");
    expect(appFiles.some(isTestFile)).toBe(false);
  });
});

describe("categories pairing — the writers", () => {
  test("the data-layer writers are exactly the three in src/data/categories.ts", () => {
    expect(
      writers.filter((writer) => writer.startsWith("src/data/")).sort(),
    ).toEqual([
      "src/data/categories.ts:insertCategory",
      "src/data/categories.ts:removeCategory",
      "src/data/categories.ts:updateCategoryName",
    ]);
  });

  test("ensureCategories is the one writer outside src/data/ (spec 08's accepted bypass)", () => {
    expect(writers.filter((writer) => !writer.startsWith("src/data/"))).toEqual(
      ["scripts/lib/categories.ts:ensureCategories"],
    );
  });

  test("no action writes the table itself", () => {
    expect(
      writers.filter((writer) => writer.startsWith("src/actions/")),
    ).toEqual([]);
  });
});

describe("categories pairing — the revalidators", () => {
  const revalidators = registryRevalidators("categories");

  // A server action reaches a writer when its module imports one from
  // @/data/categories and the action calls it.
  const reaching = serverActions.filter(({ file, fn }) => {
    const imported = importedNames(
      parseFile(file),
      (specifier) => specifier === "@/data/categories",
    );
    const called = callsInside(fn);
    return dataWriters.some(
      (writer) => imported.has(writer) && called.has(writer),
    );
  });

  test("the registry names the three category actions", () => {
    expect([...revalidators].sort()).toEqual([
      "createCategory",
      "deleteCategory",
      "renameCategory",
    ]);
  });

  test("the actions that call a category writer are exactly the registry's revalidators", () => {
    expect(reaching.map(({ name }) => name).sort()).toEqual(
      [...revalidators].sort(),
    );
  });

  test.each(revalidators)('%s calls updateTag("categories")', (name) => {
    const action = serverActions.find((candidate) => candidate.name === name);
    expect(action, `${name} is not a server action`).toBeDefined();
    expect(updateTagArgs(action!.fn)).toContain("categories");
  });

  test("no item or photo action imports a category writer", () => {
    const leaks = serverActions
      .filter(({ file }) => file !== "src/actions/categories.ts")
      .filter(({ file }) => {
        const imported = importedNames(
          parseFile(file),
          (specifier) => specifier === "@/data/categories",
        );
        return dataWriters.some((writer) => imported.has(writer));
      })
      .map(({ file, name }) => `${file}:${name}`);
    expect(leaks).toEqual([]);
  });
});
