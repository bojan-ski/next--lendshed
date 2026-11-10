import { existsSync, globSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// A static walk over the import graph, shared by the consolidation suites.
// Files are repo-relative with forward slashes ("src/db/index.ts"); packages keep
// their specifier ("better-auth/crypto"). Type-only imports are not followed, and a
// module whose first statement is "use server" is reached but not entered: a client
// import of an action is a reference, not bundled code.

export const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SOURCE_EXTENSIONS = [".ts", ".tsx"];
const CANDIDATE_SUFFIXES = ["", ".ts", ".tsx", "/index.ts", "/index.tsx"];

export type ImportGraph = {
  // Every file reached, with the chain of files that led to it (entry first).
  files: Map<string, string[]>;
  // Every package specifier reached, with the chain of files that imported it.
  packages: Map<string, string[]>;
};

export type WalkOptions = {
  // In-memory sources that take precedence over the disk (self-tests).
  sources?: Record<string, string>;
};

export function toRepoPath(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join("/");
}

function exists(file: string, sources: Record<string, string>): boolean {
  if (file in sources) return true;
  const absolute = path.join(REPO_ROOT, file);
  return existsSync(absolute) && statSync(absolute).isFile();
}

export function readSource(file: string, sources: Record<string, string> = {}) {
  return sources[file] ?? readFileSync(path.join(REPO_ROOT, file), "utf8");
}

function resolveFile(
  specifier: string,
  importer: string,
  sources: Record<string, string>,
): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = `src/${specifier.slice(2)}`;
  else if (specifier.startsWith("./") || specifier.startsWith("../")) {
    base = path.posix.join(path.posix.dirname(importer), specifier);
  } else return null;

  const match = CANDIDATE_SUFFIXES.map((suffix) => base + suffix).find((file) =>
    exists(file, sources),
  );
  if (!match) throw new Error(`Cannot resolve "${specifier}" from ${importer}`);
  return match;
}

export function parseFile(
  file: string,
  sources: Record<string, string> = {},
): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readSource(file, sources),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

export function isUseServerModule(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use server"
  );
}

export function isUseClientModule(source: ts.SourceFile): boolean {
  const first = source.statements[0];
  return (
    first !== undefined &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  );
}

function isTypeOnlyImport(node: ts.ImportDeclaration): boolean {
  const clause = node.importClause;
  if (!clause) return false; // a side-effect import
  if (clause.isTypeOnly) return true;
  if (clause.name) return false;
  const bindings = clause.namedBindings;
  return (
    bindings !== undefined &&
    ts.isNamedImports(bindings) &&
    bindings.elements.length > 0 &&
    bindings.elements.every((element) => element.isTypeOnly)
  );
}

// The runtime import specifiers of one module, in source order.
export function importSpecifiers(source: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      !isTypeOnlyImport(node)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specifiers;
}

export function walkImports(
  entries: string[],
  { sources = {} }: WalkOptions = {},
): ImportGraph {
  const files = new Map<string, string[]>();
  const packages = new Map<string, string[]>();
  const queue = entries.map((entry) => ({ file: entry, chain: [entry] }));
  for (const { file, chain } of queue) files.set(file, chain);

  while (queue.length > 0) {
    const { file, chain } = queue.shift()!;
    if (!SOURCE_EXTENSIONS.some((extension) => file.endsWith(extension))) {
      continue; // stylesheets and assets have no imports to follow
    }
    const source = parseFile(file, sources);
    if (chain.length > 1 && isUseServerModule(source)) continue;

    for (const specifier of importSpecifiers(source)) {
      const target = resolveFile(specifier, file, sources);
      if (target === null) {
        if (!packages.has(specifier)) packages.set(specifier, chain);
        continue;
      }
      if (files.has(target)) continue;
      const next = [...chain, target];
      files.set(target, next);
      queue.push({ file: target, chain: next });
    }
  }
  return { files, packages };
}

export type ForbiddenRule = {
  files?: (file: string) => boolean;
  packages?: (specifier: string) => boolean;
};

// Every forbidden module reached, as "entry → … → module" lines.
export function forbiddenReached(
  graph: ImportGraph,
  rule: ForbiddenRule,
): string[] {
  const hits: string[] = [];
  for (const [file, chain] of graph.files) {
    if (rule.files?.(file)) hits.push(chain.join(" → "));
  }
  for (const [specifier, chain] of graph.packages) {
    if (rule.packages?.(specifier)) {
      hits.push([...chain, specifier].join(" → "));
    }
  }
  return hits;
}

// Repo-relative paths of every file matching the glob, sorted.
export function sourceFiles(pattern: string): string[] {
  return globSync(pattern, { cwd: REPO_ROOT })
    .map((file) => file.split(path.sep).join("/"))
    .sort();
}
