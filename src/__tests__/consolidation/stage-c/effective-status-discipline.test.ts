import path from "node:path";
import ts from "typescript";
import { calleeName, walk } from "@/__tests__/support/ast";
import {
  parseFile,
  REPO_ROOT,
  sourceFiles,
  toRepoPath,
} from "@/__tests__/support/import-graph";

vi.setConfig({ testTimeout: 60_000 });

// One rule in three places (src/lib/dates, loan-scopes.ts, the mappers) stays
// one rule only if nothing in src/data/ goes around it:
// - no loan-status filter outside loan-scopes.ts (writes are allowed);
// - no zero-argument communityToday(): today comes from the caller;
// - a loan date enters Prisma only as toDbDate(…) and leaves it only through
//   fromDbDate(…).
// A false positive is fixed in the matcher with its reason, never by an
// exemption list.

const LOAN_STATUSES = new Set([
  "requested",
  "approved",
  "out",
  "returned",
  "declined",
  "cancelled",
  "expired",
  "lapsed",
]);
const LOAN_DATES = new Set(["startDate", "endDate", "returnedOn"]);
// Object keys whose values Prisma writes rather than filters.
const WRITE_KEYS = new Set(["data", "create", "update"]);

const PROBE = "src/data/__discipline_probe__.ts";

const dataFiles = sourceFiles("src/data/**/*.ts").filter(
  (file) => !file.endsWith(".test.ts"),
);

function createProgram(probe?: string): ts.Program {
  const config = ts.readConfigFile(
    path.join(REPO_ROOT, "tsconfig.json"),
    ts.sys.readFile,
  );
  const { options } = ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    REPO_ROOT,
  );
  // A one-off in-memory program: no build-info file to write.
  delete options.incremental;
  delete options.tsBuildInfoFile;
  const host = ts.createCompilerHost(options);
  const probePath = path.join(REPO_ROOT, PROBE);
  const isProbe = (file: string) =>
    probe !== undefined && path.resolve(file) === path.resolve(probePath);
  const { getSourceFile, fileExists, readFile } = host;
  host.fileExists = (file) => isProbe(file) || fileExists.call(host, file);
  host.readFile = (file) => (isProbe(file) ? probe : readFile.call(host, file));
  host.getSourceFile = (file, language, ...rest) =>
    isProbe(file)
      ? ts.createSourceFile(file, probe!, language, true)
      : getSourceFile.call(host, file, language, ...rest);
  const roots = [...dataFiles, ...(probe ? [PROBE] : [])].map((file) =>
    path.join(REPO_ROOT, file),
  );
  return ts.createProgram(roots, { ...options, noEmit: true }, host);
}

// --- Rule 1: loan-status filters live in loan-scopes.ts -----------------------

function loanLiteralIn(node: ts.Node): string | null {
  let found: string | null = null;
  walk(node, (child) => {
    if (found) return;
    if (ts.isStringLiteralLike(child) && LOAN_STATUSES.has(child.text)) {
      found = child.text;
    }
    if (
      ts.isPropertyAccessExpression(child) &&
      child.expression.getText().endsWith("LoanStatus")
    ) {
      found = child.getText();
    }
  });
  return found;
}

// Under `data:`, `create:` or `update:` the status is written, not filtered.
function isWritten(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isPropertyAssignment(current) &&
      WRITE_KEYS.has(current.name.getText())
    ) {
      return true;
    }
  }
  return false;
}

function statusFilters(source: ts.SourceFile): string[] {
  const hits: string[] = [];
  walk(source, (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText() === "status" &&
      !isWritten(node)
    ) {
      const literal = loanLiteralIn(node.initializer);
      if (literal) hits.push(`status: ${literal}`);
    }
    // Raw SQL: a tagged template naming status next to a loan-status value.
    if (ts.isTaggedTemplateExpression(node)) {
      const sql = node.template.getText();
      const quoted = [...sql.matchAll(/'(\w+)'/g)].map(([, value]) => value);
      if (/status/i.test(sql) && quoted.some((v) => LOAN_STATUSES.has(v))) {
        hits.push(`raw SQL: ${sql.slice(0, 60)}`);
      }
    }
  });
  return hits;
}

// --- Rule 2: no zero-argument communityToday() --------------------------------

function zeroArgumentToday(source: ts.SourceFile): string[] {
  const hits: string[] = [];
  walk(source, (node) => {
    if (
      ts.isCallExpression(node) &&
      calleeName(node) === "communityToday" &&
      node.arguments.length === 0
    ) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      hits.push(`communityToday() at line ${line + 1}`);
    }
  });
  return hits;
}

// --- Rule 3: loan dates cross Prisma through db-dates.ts ----------------------

const admitsDate = (checker: ts.TypeChecker, type: ts.Type | undefined) =>
  !!type &&
  (type.isUnion() ? type.types : [type]).some(
    (member) => checker.typeToString(member) === "Date",
  );

const isCallTo = (node: ts.Node | undefined, name: string) =>
  !!node && ts.isCallExpression(node) && calleeName(node) === name;

// toDbDate(…), or a const initialised with it.
function isDbDate(checker: ts.TypeChecker, value: ts.Expression): boolean {
  if (isCallTo(value, "toDbDate")) return true;
  if (value.kind === ts.SyntaxKind.NullKeyword) return true;
  if (!ts.isIdentifier(value)) return false;
  const declaration = checker.getSymbolAtLocation(value)?.valueDeclaration;
  return (
    !!declaration &&
    ts.isVariableDeclaration(declaration) &&
    isCallTo(declaration.initializer, "toDbDate")
  );
}

// The value a property gives Prisma: the initializer, or a shorthand's variable.
function propertyValue(
  checker: ts.TypeChecker,
  property: ts.ObjectLiteralElementLike,
): ts.Expression | null {
  if (ts.isPropertyAssignment(property)) return property.initializer;
  if (ts.isShorthandPropertyAssignment(property)) {
    const symbol = checker.getShorthandAssignmentValueSymbol(property);
    const declaration = symbol?.valueDeclaration;
    return declaration && ts.isVariableDeclaration(declaration)
      ? (declaration.initializer ?? null)
      : null;
  }
  return null;
}

// The types a property can take under the object's contextual type: Prisma
// inputs admit Date; effectiveStatus's input and the DTOs are strings, so they
// are not Prisma arguments. A filter's context is a union (`Date | string |
// DateTimeFilter`), and a union only reports properties all members share, so
// each member is asked.
function contextualPropertyTypes(
  checker: ts.TypeChecker,
  property: ts.ObjectLiteralElementLike,
): ts.Type[] {
  const objectType = checker.getContextualType(
    property.parent as ts.ObjectLiteralExpression,
  );
  const name = property.name?.getText();
  if (!objectType || !name) return [];
  return (objectType.isUnion() ? objectType.types : [objectType]).flatMap(
    (member) => {
      const symbol = member.getProperty(name);
      return symbol
        ? [checker.getTypeOfSymbolAtLocation(symbol, property)]
        : [];
    },
  );
}

function datesIntoPrisma(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): string[] {
  const hits: string[] = [];
  const check = (property: ts.ObjectLiteralElementLike, field: string) => {
    const types = contextualPropertyTypes(checker, property);
    if (!types.some((type) => admitsDate(checker, type))) return;
    const value = propertyValue(checker, property);
    if (value && ts.isObjectLiteralExpression(value)) {
      for (const inner of value.properties) check(inner, field);
      return;
    }
    if (!value || !isDbDate(checker, value)) {
      hits.push(`${field}: ${property.getText()}`);
    }
  };
  walk(source, (node) => {
    if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node)) &&
      LOAN_DATES.has(node.name.getText())
    ) {
      check(node, node.name.getText());
    }
  });
  return hits;
}

function datesOutOfPrisma(
  checker: ts.TypeChecker,
  source: ts.SourceFile,
): string[] {
  const hits: string[] = [];
  walk(source, (node) => {
    if (
      ts.isPropertyAccessExpression(node) &&
      LOAN_DATES.has(node.name.text) &&
      admitsDate(checker, checker.getTypeAtLocation(node)) &&
      !isCallTo(node.parent, "fromDbDate")
    ) {
      hits.push(node.getText());
    }
  });
  return hits;
}

// --- The sweep -----------------------------------------------------------------

type Report = Record<string, string[]>;

function sweep(program: ts.Program, files: string[]): Report {
  const checker = program.getTypeChecker();
  const report: Report = {};
  for (const file of files) {
    const source = program.getSourceFile(path.join(REPO_ROOT, file))!;
    const hits = [
      ...(file === "src/data/loan-scopes.ts" ? [] : statusFilters(source)),
      ...zeroArgumentToday(source),
      ...(file === "src/data/db-dates.ts"
        ? []
        : [
            ...datesIntoPrisma(checker, source),
            ...datesOutOfPrisma(checker, source),
          ]),
    ];
    if (hits.length > 0) report[toRepoPath(source.fileName)] = hits;
  }
  return report;
}

describe("effective-status discipline — the matchers", () => {
  const probe = `
import { fromDbDate, toDbDate } from "@/data/db-dates";
import type { Prisma } from "@/generated/prisma/client";
import { communityToday } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";

const day = toDbDate("2026-11-11");
export const scoped: Prisma.LoanWhereInput = { startDate: { gte: day } };
export const direct: Prisma.LoanWhereInput = { endDate: toDbDate("2026-11-11") };
export const raw: Prisma.LoanWhereInput = { endDate: { lt: "2026-11-11" } };
export const filtered: Prisma.LoanWhereInput = { status: { in: ["approved"] } };
export const write = {
  where: { id: "x" },
  data: { status: "declined", returnedOn: null },
} satisfies Prisma.LoanUpdateArgs;
export const nested = { loans: { where: { status: "out" } } };
export const select = { startDate: true, endDate: true } satisfies Prisma.LoanSelect;
export const order = [{ startDate: "asc" }] satisfies Prisma.LoanOrderByWithRelationInput[];
export const today = communityToday();
export const converted = communityToday(new Date());
export function map(row: { status: "out"; startDate: Date; endDate: Date }) {
  const startDate = fromDbDate(row.startDate);
  const endDate = row.endDate.toISOString().slice(0, 10);
  return effectiveStatus({ status: row.status, startDate, endDate }, "2026-11-11");
}
`;
  const program = createProgram(probe);
  const report = sweep(program, [PROBE]);

  test("the probe type-checks, so the contextual types are real", () => {
    const errors = ts
      .getPreEmitDiagnostics(
        program,
        program.getSourceFile(path.join(REPO_ROOT, PROBE)),
      )
      .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    expect(errors).toEqual([]);
  });

  test("flags exactly the filters, the bare today, the raw date and the bypassed read", () => {
    expect(report[PROBE]).toEqual([
      "status: approved",
      "status: out",
      "communityToday() at line 19",
      'endDate: lt: "2026-11-11"',
      "row.endDate",
    ]);
  });
});

// A Server Component reads requestToday(): the header badge renders on every
// (app) page, so a second read could land after midnight (rules/dates.md, 17a).
const renderFiles = [
  ...sourceFiles("src/components/**/*.{ts,tsx}"),
  ...sourceFiles("src/app/**/*.{ts,tsx}"),
].filter((file) => !/\.test\.tsx?$/.test(file));

describe("effective-status discipline — src/components/ and src/app/", () => {
  test("covers the sections that read today", () => {
    expect(renderFiles).toContain("src/components/browse/BrowseSection.tsx");
    expect(renderFiles).toContain("src/components/loans/NeedsActionBadge.tsx");
    expect(renderFiles).toContain("src/app/(app)/layout.tsx");
  });

  // Without React's cache each call reads the clock again; Vitest can't run a
  // request scope to prove the memoising, so the shape is pinned here.
  test("requestToday is React's cache(...) over communityToday", () => {
    const source = parseFile("src/lib/dates/request-today.ts");
    const fromReact = source.statements.some(
      (statement) =>
        ts.isImportDeclaration(statement) &&
        (statement.moduleSpecifier as ts.StringLiteral).text === "react" &&
        statement.importClause?.namedBindings !== undefined &&
        ts.isNamedImports(statement.importClause.namedBindings) &&
        statement.importClause.namedBindings.elements.some(
          (element) => element.name.text === "cache",
        ),
    );
    let wrapped = false;
    walk(source, (node) => {
      if (
        ts.isVariableDeclaration(node) &&
        node.name.getText() === "requestToday" &&
        node.initializer !== undefined &&
        ts.isCallExpression(node.initializer) &&
        calleeName(node.initializer) === "cache"
      ) {
        wrapped = true;
      }
    });
    expect({ fromReact, wrapped }).toEqual({ fromReact: true, wrapped: true });
  });

  test("no zero-argument communityToday(): sections read requestToday()", () => {
    const report: Report = {};
    for (const file of renderFiles) {
      const hits = zeroArgumentToday(parseFile(file));
      if (hits.length > 0) report[file] = hits;
    }
    expect(report).toEqual({});
  });
});

describe("effective-status discipline — src/data/", () => {
  test("covers every non-test data module", () => {
    expect(dataFiles).toContain("src/data/loan-scopes.ts");
    expect(dataFiles).toContain("src/data/browse.ts");
    expect(dataFiles.some((file) => file.endsWith(".test.ts"))).toBe(false);
  });

  test("nothing in src/data/ goes around loan-scopes.ts or db-dates.ts", () => {
    expect(sweep(createProgram(), dataFiles)).toEqual({});
  });
});
