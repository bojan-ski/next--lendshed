import ts from "typescript";

// Small AST queries for the static guards: who calls what, inside which function.

export function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

// The nearest function-like node around `node` (the module itself when none).
export function enclosingFunction(node: ts.Node): ts.Node {
  let current = node.parent;
  while (current && !ts.isFunctionLike(current)) current = current.parent;
  return current ?? node.getSourceFile();
}

// `foo(...)` → "foo"; `a.b.foo(...)` → "foo".
export function calleeName(call: ts.CallExpression): string | null {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return null;
}

export function callsIn(source: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  walk(source, (node) => {
    if (ts.isCallExpression(node)) calls.push(node);
  });
  return calls;
}

// Value (not type-only) names a module imports from specifiers matching `test`.
export function importedNames(
  source: ts.SourceFile,
  test: (specifier: string) => boolean,
): Set<string> {
  const names = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (!test((statement.moduleSpecifier as ts.StringLiteral).text)) continue;
    if (clause.name) names.add(clause.name.text);
    const bindings = clause.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        if (!element.isTypeOnly) names.add(element.name.text);
      }
    }
  }
  return names;
}
