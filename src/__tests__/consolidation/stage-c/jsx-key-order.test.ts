import ts from "typescript";
import { walk } from "@/__tests__/support/ast";
import { parseFile, sourceFiles } from "@/__tests__/support/import-graph";

// A `key` after a `{...spread}` compiles to createElement, whose dev build
// reports the element's children as a list without keys ("Check the render
// method of Field" on the item form, 12a ui-reviewer). Keys go first.

const tsxFiles = sourceFiles("src/**/*.tsx").filter(
  (file) => !file.includes(".test."),
);

function keysAfterSpread(file: string): string[] {
  const source = parseFile(file);
  const hits: string[] = [];
  walk(source, (node) => {
    if (!ts.isJsxAttributes(node)) return;
    let spread = false;
    for (const attribute of node.properties) {
      if (ts.isJsxSpreadAttribute(attribute)) spread = true;
      else if (spread && attribute.name.getText() === "key") {
        const { line } = source.getLineAndCharacterOfPosition(
          attribute.getStart(),
        );
        hits.push(`${file}:${line + 1}`);
      }
    }
  });
  return hits;
}

test("the scan sees the item form's fields", () => {
  expect(tsxFiles).toContain("src/components/items/ItemDetailsFields.tsx");
});

test("no JSX element sets key after a spread", () => {
  expect(tsxFiles.flatMap(keysAfterSpread)).toEqual([]);
});
