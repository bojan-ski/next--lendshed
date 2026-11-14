import ts from "typescript";
import { importSpecifiers, parseFile } from "@/__tests__/support/import-graph";
import robots from "./robots";

const FILE = "src/app/robots.ts";
const source = parseFile(FILE);

describe("robots.txt", () => {
  test("disallows everything for every crawler: one rule, no allow, sitemap or host", () => {
    expect(robots()).toStrictEqual({
      rules: { userAgent: "*", disallow: "/" },
    });
  });

  test("has no runtime import", () => {
    expect(importSpecifiers(source)).toEqual([]);
  });

  test("its only import is the MetadataRoute type from next", () => {
    const imports = source.statements.filter(ts.isImportDeclaration);
    expect(imports).toHaveLength(1);
    const [declaration] = imports;
    expect((declaration.moduleSpecifier as ts.StringLiteral).text).toBe("next");
    const clause = declaration.importClause;
    expect(clause?.isTypeOnly).toBe(true);
    const bindings = clause?.namedBindings;
    expect(
      bindings && ts.isNamedImports(bindings)
        ? bindings.elements.map((element) => element.name.text)
        : [],
    ).toEqual(["MetadataRoute"]);
  });

  test("has no directive, no segment config and no export but the default function", () => {
    const directives = source.statements.filter(
      (statement) =>
        ts.isExpressionStatement(statement) &&
        ts.isStringLiteral(statement.expression),
    );
    expect(directives).toEqual([]);

    const rest = source.statements.filter(
      (statement) => !ts.isImportDeclaration(statement),
    );
    expect(rest).toHaveLength(1);
    const [only] = rest;
    expect(ts.isFunctionDeclaration(only)).toBe(true);
    const modifiers = ts.canHaveModifiers(only)
      ? (ts.getModifiers(only) ?? []).map((modifier) => modifier.kind)
      : [];
    expect(modifiers).toEqual([
      ts.SyntaxKind.ExportKeyword,
      ts.SyntaxKind.DefaultKeyword,
    ]);
  });
});
