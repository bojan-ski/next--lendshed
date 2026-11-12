import ts from "typescript";
import { calleeName, walk } from "@/__tests__/support/ast";
import { parseFile, sourceFiles } from "@/__tests__/support/import-graph";

// An action's `unexpected` result leaves an operator trace: every catch in
// src/actions/ binds the error and first calls reportUnexpected with its own
// function's name and that error (12a, conventions-auditor).

const actionFiles = sourceFiles("src/actions/**/*.ts").filter(
  (file) => !file.endsWith(".test.ts"),
);

function enclosingName(node: ts.Node): string | null {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionDeclaration(current) && current.name) {
      return current.name.text;
    }
  }
  return null;
}

function unreported(file: string): string[] {
  const source = parseFile(file);
  const misses: string[] = [];
  walk(source, (node) => {
    if (!ts.isCatchClause(node)) return;
    const name = enclosingName(node);
    const binding = node.variableDeclaration?.name.getText();
    const [first] = node.block.statements;
    const call =
      first &&
      ts.isExpressionStatement(first) &&
      ts.isCallExpression(first.expression)
        ? first.expression
        : null;
    const [label, error] = call?.arguments ?? [];
    const reported =
      call !== null &&
      calleeName(call) === "reportUnexpected" &&
      !!label &&
      ts.isStringLiteral(label) &&
      label.text === name &&
      !!binding &&
      error?.getText() === binding;
    if (!reported) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart());
      misses.push(`${file}:${line + 1} (${name})`);
    }
  });
  return misses;
}

test("the sweep covers the action modules that catch", () => {
  expect(actionFiles).toEqual(
    expect.arrayContaining([
      "src/actions/categories.ts",
      "src/actions/items.ts",
      "src/actions/photos.ts",
    ]),
  );
});

test("every catch in src/actions/ reports the error under its action's name", () => {
  expect(actionFiles.flatMap(unreported)).toEqual([]);
});
