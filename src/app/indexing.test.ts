import { existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walk } from "@/__tests__/support/ast";
import {
  parseFile,
  readSource,
  REPO_ROOT,
  sourceFiles,
} from "@/__tests__/support/import-graph";

// PRIVATE mode: the root layout's `robots` reaches every page only while no other
// segment defines `robots`, `openGraph` or `twitter` (Next replaces a nested field
// with the last segment's value instead of merging it).
const PAGE_COUNT = 20;
const ROOT_LAYOUT = "src/app/layout.tsx";
const SEO_KEYS = ["robots", "openGraph", "twitter"];

const isTest = (file: string) => /\.test\.tsx?$/.test(file);
const segmentFiles = sourceFiles("src/app/**/*.{ts,tsx}").filter(
  (file) => !isTest(file),
);

type Properties = Map<string, ts.Expression | undefined>;

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    )
  );
}

function seoKeysInside(node: ts.Node): string[] {
  const keys = new Set<string>();
  walk(node, (child) => {
    if (!ts.isObjectLiteralExpression(child)) return;
    for (const property of child.properties) {
      const name = property.name && propertyName(property.name);
      if (name && SEO_KEYS.includes(name)) keys.add(name);
    }
  });
  return [...keys];
}

function readMetadataObject(
  initializer: ts.Expression | undefined,
  properties: Properties,
  problems: string[],
) {
  const value = initializer && unwrap(initializer);
  if (!value || !ts.isObjectLiteralExpression(value)) {
    problems.push("metadata is not an object literal");
    return;
  }
  for (const property of value.properties) {
    if (ts.isSpreadAssignment(property)) {
      problems.push("metadata spreads another object");
      continue;
    }
    const name = property.name && propertyName(property.name);
    if (!name) {
      problems.push("metadata has a computed key");
      continue;
    }
    properties.set(
      name,
      ts.isPropertyAssignment(property) ? property.initializer : undefined,
    );
  }
}

// The exported metadata of one segment file, read from its AST.
function inspect(file: string, sources: Record<string, string> = {}) {
  const properties: Properties = new Map();
  const problems: string[] = [];
  for (const statement of parseFile(file, sources).statements) {
    if (ts.isExportDeclaration(statement)) {
      const names =
        statement.exportClause && ts.isNamedExports(statement.exportClause)
          ? statement.exportClause.elements.map((element) => element.name.text)
          : null;
      if (statement.moduleSpecifier) {
        problems.push("re-exports from another module");
      } else if (
        names?.some(
          (name) => name === "metadata" || name === "generateMetadata",
        )
      ) {
        problems.push("exports metadata indirectly");
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) {
      if (statement.name?.text === "generateMetadata") {
        for (const key of seoKeysInside(statement)) {
          problems.push(`generateMetadata defines ${key}`);
        }
      }
      continue;
    }
    if (!ts.isVariableStatement(statement) || !isExported(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;
      if (declaration.name.text === "metadata") {
        readMetadataObject(declaration.initializer, properties, problems);
      } else if (
        declaration.name.text === "generateMetadata" &&
        declaration.initializer
      ) {
        for (const key of seoKeysInside(declaration.initializer)) {
          problems.push(`generateMetadata defines ${key}`);
        }
      }
    }
  }
  return { properties, problems };
}

function findings(file: string, sources: Record<string, string> = {}) {
  const { properties, problems } = inspect(file, sources);
  return [
    ...problems,
    ...SEO_KEYS.filter((key) => properties.has(key)).map(
      (key) => `metadata defines ${key}`,
    ),
  ];
}

describe("indexing: the derived segment walk", () => {
  test(`finds exactly ${PAGE_COUNT} pages`, () => {
    expect(
      segmentFiles.filter((file) => file.endsWith("/page.tsx")),
    ).toHaveLength(PAGE_COUNT);
  });

  test("the root layout sets robots to exactly { index: false, follow: false }", () => {
    const { properties, problems } = inspect(ROOT_LAYOUT);
    expect(problems).toEqual([]);
    const robots = properties.get("robots");
    expect(robots && ts.isObjectLiteralExpression(robots)).toBe(true);
    const entries = (robots as ts.ObjectLiteralExpression).properties.map(
      (property) => [
        property.name && propertyName(property.name),
        ts.isPropertyAssignment(property)
          ? property.initializer.kind === ts.SyntaxKind.FalseKeyword
          : null,
      ],
    );
    expect(entries).toEqual([
      ["index", true],
      ["follow", true],
    ]);
  });

  test("the root layout owns the one share card: openGraph, twitter and metadataBase", () => {
    const { properties } = inspect(ROOT_LAYOUT);
    for (const key of ["openGraph", "twitter", "metadataBase", "description"]) {
      expect(properties.has(key), key).toBe(true);
    }
  });

  test.each(segmentFiles.filter((file) => file !== ROOT_LAYOUT))(
    "%s defines no robots, openGraph or twitter",
    (file) => {
      expect(findings(file)).toEqual([]);
    },
  );
});

describe("indexing: the metadata reader flags what it cannot clear", () => {
  const FILE = "src/app/example/page.tsx";
  const flagged = (code: string) => findings(FILE, { [FILE]: code });

  test.each([
    [
      "a plain title",
      'import type { Metadata } from "next";\nexport const metadata: Metadata = { title: "Example" };',
      [],
    ],
    [
      "a spread",
      'const base = {};\nexport const metadata = { ...base, title: "Example" };',
      ["metadata spreads another object"],
    ],
    [
      "a non-literal value",
      "const shared = {};\nexport const metadata = shared;",
      ["metadata is not an object literal"],
    ],
    [
      "a named re-export",
      'export { metadata } from "./shared";',
      ["re-exports from another module"],
    ],
    [
      "a star re-export",
      'export * from "./shared";',
      ["re-exports from another module"],
    ],
    [
      "an indirect export",
      'const metadata = { title: "Example" };\nexport { metadata };',
      ["exports metadata indirectly"],
    ],
    [
      "robots behind satisfies",
      'export const metadata = { title: "Example", robots: { index: true } } satisfies Metadata;',
      ["metadata defines robots"],
    ],
    [
      "openGraph and twitter in generateMetadata",
      'export async function generateMetadata() {\n  return { title: "x", openGraph: { title: "x" }, twitter: { card: "summary" } };\n}',
      [
        "generateMetadata defines openGraph",
        "generateMetadata defines twitter",
      ],
    ],
    [
      "robots in an arrow generateMetadata",
      "export const generateMetadata = async () => ({ robots: { index: true } });",
      ["generateMetadata defines robots"],
    ],
  ])("%s", (_name, code, expected) => {
    expect(flagged(code)).toEqual(expected);
  });
});

describe("indexing: no SEO surface beside the root", () => {
  test("robots.ts is the only robots file and no sitemap, manifest or share image exists", () => {
    expect(
      sourceFiles("src/app/**/robots.*").filter((file) => !isTest(file)),
    ).toEqual(["src/app/robots.ts"]);
    expect(
      sourceFiles(
        "src/app/**/{sitemap,manifest,opengraph-image,twitter-image}.*",
      ),
    ).toEqual([]);
  });

  test.each(["public/robots.txt", "public/sitemap.xml"])(
    "%s does not exist (a static file would shadow the route)",
    (file) => {
      expect(existsSync(path.join(REPO_ROOT, file))).toBe(false);
    },
  );
});

describe("indexing: no SEO_INDEXABLE switch", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [name, value] of Object.entries({
      DATABASE_URL: "postgresql://user:secret@pooler.example.test/db",
      DATABASE_URL_UNPOOLED: "postgresql://user:secret@direct.example.test/db",
      COMMUNITY_NAME: "Elm Street",
      AUTH_SECRET: "secret-auth-0123456789abcdefghijklmnop",
      APP_URL: "http://localhost:3000",
      STORAGE_DRIVER: "disk",
      BLOB_READ_WRITE_TOKEN: "",
      BLOB_PUBLIC_HOST: "",
      CRON_SECRET: undefined,
      VERCEL: undefined,
      NEXT_PUBLIC_APP_NAME: "Lendshed",
    })) {
      vi.stubEnv(name, value);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("the server schema has no SEO_INDEXABLE key", async () => {
    const { serverEnvSchema } = await import("@/lib/env/server");
    expect(Object.keys(serverEnvSchema.shape)).toContain("APP_URL");
    expect(Object.keys(serverEnvSchema.shape)).not.toContain("SEO_INDEXABLE");
  });

  test("the public schema has no SEO_INDEXABLE key", async () => {
    const { publicEnvSchema } = await import("@/lib/env/public");
    expect(Object.keys(publicEnvSchema.shape)).toContain(
      "NEXT_PUBLIC_APP_NAME",
    );
    expect(Object.keys(publicEnvSchema.shape)).not.toContain("SEO_INDEXABLE");
  });

  test(".env.example has no SEO_INDEXABLE", () => {
    expect(readSource(".env.example")).not.toContain("SEO_INDEXABLE");
  });
});
