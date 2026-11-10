import ts from "typescript";
import {
  isUseServerModule,
  parseFile,
  readSource,
  sourceFiles,
} from "@/__tests__/support/import-graph";

export type InventoryRow = { name: string; auth: string };

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

// The rows of the first table under "### Server Actions" in project-data.md. A
// name cell may hold several actions ("`promoteMember` / `demoteMember`"):
// each becomes its own row with the shared auth cell.
export function inventoryRows(): InventoryRow[] {
  const document = readSource("context/project-data.md");
  const section = document.split("### Server Actions")[1] ?? "";
  const rows: InventoryRow[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("### ")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    if (!/^`\w+`( \/ `\w+`)*$/.test(cells[1] ?? "")) continue;
    for (const [, name] of cells[1].matchAll(/`(\w+)`/g)) {
      rows.push({ name, auth: cells[3] });
    }
  }
  return rows;
}

// The role an auth cell leads with: "organizer, not self; …" → "organizer".
export const leadingRole = (auth: string) => auth.split(/[,;]/)[0].trim();
