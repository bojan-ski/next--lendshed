import ts from "typescript";
import {
  isUseServerModule,
  parseFile,
  readSource,
  sourceFiles,
} from "@/__tests__/support/import-graph";

export type InventoryRow = {
  name: string;
  input: string;
  auth: string;
  revalidates: string;
  result: string;
};

// Every exported name of every "use server" module under src/actions/.
export function serverActionExports(): { file: string; name: string }[] {
  return sourceFiles("src/actions/**/*.ts")
    .filter((file) => !file.endsWith(".test.ts"))
    .map((file) => ({ file, source: parseFile(file) }))
    .filter(({ source }) => isUseServerModule(source))
    .flatMap(({ file, source }) =>
      source.statements.flatMap((statement) => {
        const exported = ts
          .getModifiers(statement as ts.HasModifiers)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (exported && ts.isFunctionDeclaration(statement) && statement.name) {
          return [{ file, name: statement.name.text }];
        }
        if (exported && ts.isVariableStatement(statement)) {
          return statement.declarationList.declarations.map((declaration) => ({
            file,
            name: declaration.name.getText(source),
          }));
        }
        if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
          throw new Error(`${file}: re-exports hide actions from this sweep`);
        }
        return [];
      }),
    );
}

// Each exported action of a "use server" source with the functions its body
// runs: its own declaration, then every module-private function it reaches by
// direct call ("changeRole" behind promoteMember), in call order.
export function actionFunctions(
  source: ts.SourceFile,
): Map<string, ts.FunctionDeclaration[]> {
  const declarations = new Map<string, ts.FunctionDeclaration>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      declarations.set(statement.name.text, statement);
    }
  }
  const exported = (node: ts.FunctionDeclaration) =>
    ts
      .getModifiers(node)
      ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;

  const reach = (start: ts.FunctionDeclaration) => {
    const seen: ts.FunctionDeclaration[] = [];
    const visit = (node: ts.FunctionDeclaration) => {
      if (seen.includes(node)) return;
      seen.push(node);
      const pending: ts.FunctionDeclaration[] = [];
      const walkNode = (child: ts.Node) => {
        if (ts.isCallExpression(child) && ts.isIdentifier(child.expression)) {
          const callee = declarations.get(child.expression.text);
          if (callee && !exported(callee)) pending.push(callee);
        }
        ts.forEachChild(child, walkNode);
      };
      ts.forEachChild(node, walkNode);
      pending.forEach(visit);
    };
    visit(start);
    return seen;
  };

  const actions = new Map<string, ts.FunctionDeclaration[]>();
  for (const [name, node] of declarations) {
    if (exported(node)) actions.set(name, reach(node));
  }
  return actions;
}

// The rows of the first table under "### Server Actions" in project-data.md. A
// name cell may hold several actions ("`promoteMember` / `demoteMember`"):
// each becomes its own row with the shared cells. A cell's own `\|` is text,
// not a column break.
export function inventoryRows(): InventoryRow[] {
  const document = readSource("context/project-data.md");
  const section = document.split("### Server Actions")[1] ?? "";
  const rows: InventoryRow[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("### ")) break;
    const cells = line
      .split(/(?<!\\)\|/)
      .map((cell) => cell.trim().replaceAll("\\|", "|"));
    if (!/^`\w+`( \/ `\w+`)*$/.test(cells[1] ?? "")) continue;
    for (const [, name] of cells[1].matchAll(/`(\w+)`/g)) {
      rows.push({
        name,
        input: cells[2],
        auth: cells[3],
        revalidates: cells[4],
        result: cells[5],
      });
    }
  }
  return rows;
}

// The role an auth cell leads with: "organizer, not self; …" → "organizer".
export const leadingRole = (auth: string) => auth.split(/[,;]/)[0].trim();
