import ts from "typescript";
import {
  importSpecifiers,
  parseFile,
  readSource,
  sourceFiles,
  walkImports,
} from "@/__tests__/support/import-graph";

// Spec 13: the seen-at write never runs during a prefetch. Partial
// Prefetching leaves params-dependent, uncached content out of the App Shell,
// so the page must read params only inside its Suspense'd section, nothing on
// the path may be cached, and only that section may call the writing read.

const PAGE = "src/app/(app)/loans/[id]/page.tsx";
const SECTION = "src/components/loans/LoanDetailSection.tsx";

function nodes(source: ts.SourceFile): ts.Node[] {
  const all: ts.Node[] = [];
  const visit = (node: ts.Node) => {
    all.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return all;
}

const tagName = (node: ts.JsxElement | ts.JsxSelfClosingElement) =>
  (ts.isJsxElement(node) ? node.openingElement : node).tagName.getText();

describe("the loan page and prefetch", () => {
  test("the page never awaits params; it passes them to the section inside Suspense", () => {
    const source = parseFile(PAGE);
    const all = nodes(source);

    expect(all.some(ts.isAwaitExpression)).toBe(false);
    // Reads only: not the destructured parameter, not the attribute's name.
    const uses = all.filter(
      (node) =>
        ts.isIdentifier(node) &&
        node.text === "params" &&
        !ts.isBindingElement(node.parent) &&
        !ts.isJsxAttribute(node.parent),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const use of uses) {
      const attribute = use.parent.parent;
      expect(ts.isJsxAttribute(attribute)).toBe(true);
      const element = attribute.parent.parent as ts.JsxSelfClosingElement;
      expect(tagName(element)).toBe("LoanDetailSection");
      const suspense = element.parent;
      expect(ts.isJsxElement(suspense) && tagName(suspense)).toBe("Suspense");
    }
  });

  test("the section awaits params itself", () => {
    expect(
      nodes(parseFile(SECTION)).some(
        (node) =>
          ts.isAwaitExpression(node) && node.expression.getText() === "params",
      ),
    ).toBe(true);
  });

  test("no module on the page's path is cached", () => {
    const reached = [...walkImports([PAGE]).files.keys()];
    expect(reached).toContain(SECTION);
    expect(reached).toContain("src/data/loans.ts");
    expect(
      reached.filter((file) => /["']use cache/.test(readSource(file))),
    ).toEqual([]);
  });

  test("only the section imports the writing read", () => {
    const callers = sourceFiles("src/**/*.{ts,tsx}").filter((file) => {
      if (/\.test\.tsx?$/.test(file) || file.startsWith("src/generated/")) {
        return false;
      }
      return (
        importSpecifiers(parseFile(file)).includes("@/data/loans") &&
        readSource(file).includes("getLoanForViewer")
      );
    });
    expect(callers).toEqual([SECTION]);
  });
});
