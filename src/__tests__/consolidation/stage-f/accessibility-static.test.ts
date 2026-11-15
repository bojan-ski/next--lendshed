/// <reference types="vite/client" />
import ts from "typescript";
import css from "@/app/globals.css?raw";
import { walk } from "@/__tests__/support/ast";
import {
  parseFile,
  readSource,
  sourceFiles,
} from "@/__tests__/support/import-graph";
import { guardChain, type Guard } from "@/__tests__/support/route-guards";
import { routeParams, routePattern } from "@/__tests__/support/routeParams";
import { buttonClasses } from "@/components/ui/button-styles";
import {
  type Persona,
  RESPONSIVE_PAGES,
} from "../../../../e2e/support/responsive-pages";

// Spec 25: the Delivery Goal's WCAG rules that the source alone can prove. The
// 360 px sweep (e2e/responsive.spec.ts) proves the rendered side.

// Findings against app code (spec 25 "Handling findings"): each cell stays a
// failing test until its fix/ branch lands and removes the mark.
const FINDINGS: Record<string, string> = {};

type ClassList = { file: string; line: number; tokens: string[] };

const CLASS_HELPER = /^(cn|\w+Classes)$/;

// Every string literal under `node`, with same-file string constants resolved.
function literalsUnder(
  node: ts.Node,
  constants: Map<string, string[]>,
): string[] {
  const found: string[] = [];
  walk(node, (child) => {
    if (
      ts.isStringLiteral(child) ||
      ts.isNoSubstitutionTemplateLiteral(child)
    ) {
      found.push(child.text);
    } else if (ts.isIdentifier(child) && constants.has(child.text)) {
      found.push(...constants.get(child.text)!);
    }
  });
  return found;
}

// Same-file `const NAME = "…"` and `const NAME = ["…", …]`.
function stringConstants(source: ts.SourceFile): Map<string, string[]> {
  const constants = new Map<string, string[]>();
  walk(source, (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer) ||
        ts.isArrayLiteralExpression(node.initializer))
    ) {
      const values: string[] = [];
      walk(node.initializer, (child) => {
        if (
          ts.isStringLiteral(child) ||
          ts.isNoSubstitutionTemplateLiteral(child)
        ) {
          values.push(child.text);
        }
      });
      constants.set(node.name.text, values);
    }
  });
  return constants;
}

const tokensOf = (values: string[]) =>
  values.flatMap((value) => value.split(/\s+/)).filter(Boolean);

// The class lists of one module: each JSX className value, and the string
// arguments of each `cn(…)` / `*Classes(…)` call.
function classLists(file: string, source: ts.SourceFile): ClassList[] {
  const constants = stringConstants(source);
  const lists: ClassList[] = [];
  const line = (node: ts.Node) =>
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  walk(source, (node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "className" &&
      node.initializer
    ) {
      lists.push({
        file,
        line: line(node),
        tokens: tokensOf(literalsUnder(node.initializer, constants)),
      });
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      CLASS_HELPER.test(node.expression.text)
    ) {
      lists.push({
        file,
        line: line(node),
        tokens: tokensOf(
          node.arguments.flatMap((arg) => literalsUnder(arg, constants)),
        ),
      });
    }
  });
  return lists;
}

// "md:focus-visible:outline-2" → variants ["md", "focus-visible"], utility "outline-2".
function parseToken(token: string) {
  const parts = token.split(/:(?![^[]*\])/);
  return { variants: parts.slice(0, -1), utility: parts.at(-1)! };
}

const REMOVES_OUTLINE = new Set([
  "outline-none",
  "outline-hidden",
  "outline-0",
]);
const RING = ["outline-2", "outline-offset-2", "outline-accent"];
const FOCUS_VARIANTS = new Set(["focus-visible", "has-focus-visible"]);

// A removal is allowed only beside the full focus-visible replacement.
function outlineProblems(list: ClassList): string[] {
  const removals = list.tokens.filter((token) =>
    REMOVES_OUTLINE.has(parseToken(token).utility),
  );
  if (removals.length === 0) return [];
  const replaced = RING.every((ring) =>
    list.tokens.some((token) => {
      const { variants, utility } = parseToken(token);
      return utility === ring && variants.some((v) => FOCUS_VARIANTS.has(v));
    }),
  );
  return replaced
    ? []
    : removals.map((token) => `${list.file}:${list.line} ${token}`);
}

const MOTION =
  /^(animate-.+|transition(-.+)?|duration-.+|delay-.+|ease-.+|scroll-smooth)$/;

function motionProblems(list: ClassList): string[] {
  return list.tokens
    .filter((token) => {
      const { variants, utility } = parseToken(token);
      const moving = MOTION.test(utility) || variants.includes("starting");
      return moving && !variants.includes("motion-safe");
    })
    .map((token) => `${list.file}:${list.line} ${token}`);
}

const HEIGHT = /^-?(h|min-h|max-h|size)-/;

const appFiles = sourceFiles("src/**/*.{ts,tsx}").filter(
  (file) => !/\.test\.tsx?$/.test(file) && !file.startsWith("src/__tests__/"),
);
const listsByFile = new Map(
  appFiles.map((file) => [file, classLists(file, parseFile(file))]),
);
const allLists = [...listsByFile.values()].flat();

// The className values handed to Button / ButtonLink and buttonClasses' second
// argument: twMerge lets a height there override the kit's h-12.
function buttonOverrides(file: string, source: ts.SourceFile): string[] {
  const constants = stringConstants(source);
  const problems: string[] = [];
  const heights = (node: ts.Node) =>
    tokensOf(literalsUnder(node, constants)).filter((token) =>
      HEIGHT.test(parseToken(token).utility),
    );
  walk(source, (node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ["Button", "ButtonLink"].includes(node.tagName.getText(source))
    ) {
      for (const attribute of node.attributes.properties) {
        if (
          ts.isJsxAttribute(attribute) &&
          attribute.name.getText(source) === "className" &&
          attribute.initializer
        ) {
          problems.push(
            ...heights(attribute.initializer).map((t) => `${file} ${t}`),
          );
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "buttonClasses" &&
      node.arguments[1]
    ) {
      problems.push(...heights(node.arguments[1]).map((t) => `${file} ${t}`));
    }
  });
  return problems;
}

const baseLayer = /@layer base\s*\{([\s\S]*)\}\s*$/.exec(css)?.[1] ?? "";
const themeBlock = /@theme\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";

describe("focus", () => {
  test("@layer base holds the one :focus-visible rule: 2px solid accent, 2px offset", () => {
    expect(css.match(/:focus-visible\s*\{/g)).toHaveLength(1);
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(baseLayer)?.[1] ?? "";
    expect(rule).toMatch(/outline:\s*2px solid var\(--color-accent\);/);
    expect(rule).toMatch(/outline-offset:\s*2px;/);
    expect(themeBlock).toMatch(/--color-accent:\s*#[0-9a-f]{6};/i);
  });

  test("no CSS sets outline: none or 0", () => {
    expect(css).not.toMatch(/outline:\s*(none|0)\b/);
  });

  test(`class lists found in ${listsByFile.size} modules`, () => {
    expect(allLists.length).toBeGreaterThan(100);
  });

  describe.each(
    [...listsByFile.keys()].filter((f) => listsByFile.get(f)!.length),
  )("%s", (file) => {
    const cell = FINDINGS[file] ? test.fails : test;
    cell(
      `never removes the focus ring without a replacement${FINDINGS[file] ? ` (${FINDINGS[file]})` : ""}`,
      () => {
        expect(listsByFile.get(file)!.flatMap(outlineProblems)).toEqual([]);
      },
    );
  });
});

describe("motion", () => {
  test("the reduce block collapses every animation, transition and smooth scroll", () => {
    const block =
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\*,\s*::before,\s*::after\s*\{([^}]*)\}/.exec(
        baseLayer,
      )?.[1] ?? "";
    for (const declaration of [
      "animation-duration: 0.01ms !important;",
      "animation-iteration-count: 1 !important;",
      "transition-duration: 0.01ms !important;",
      "scroll-behavior: auto !important;",
    ]) {
      expect(block).toContain(declaration);
    }
  });

  test("every motion utility sits behind motion-safe:", () => {
    expect(allLists.flatMap(motionProblems)).toEqual([]);
  });

  test("globals.css is the only stylesheet under src/", () => {
    expect(sourceFiles("src/**/*.css")).toEqual(["src/app/globals.css"]);
  });
});

describe("buttons", () => {
  test("both variants are 48 px high (h-12)", () => {
    for (const variant of ["primary", "outline"] as const) {
      expect(buttonClasses(variant).split(" ")).toContain("h-12");
    }
  });

  test("Button and ButtonLink render through buttonClasses", () => {
    for (const file of [
      "src/components/ui/Button.tsx",
      "src/components/ui/ButtonLink.tsx",
    ]) {
      expect(readSource(file), file).toContain(
        "className={buttonClasses(variant, className)}",
      );
    }
  });

  test("no className handed to a kit button carries a height utility", () => {
    expect(
      appFiles
        .filter((file) => file.endsWith(".tsx") || file.endsWith(".ts"))
        .flatMap((file) => buttonOverrides(file, parseFile(file))),
    ).toEqual([]);
  });
});

describe("the sweep can't drift", () => {
  const layouts = sourceFiles("src/app/**/layout.tsx");
  const pages = sourceFiles("src/app/**/page.tsx").map((file) => ({
    pattern: routePattern(file),
    guard: guardChain(file, layouts)[0],
  }));
  const PERSONAS: Record<Guard, Persona[]> = {
    none: ["guest"],
    viewerGate: ["member", "organizer"],
    requireOrganizer: ["organizer"],
  };

  test("RESPONSIVE_PAGES is the 20 derived pages", () => {
    expect(RESPONSIVE_PAGES.map(({ pattern }) => pattern).sort()).toEqual(
      pages.map(({ pattern }) => pattern).sort(),
    );
    expect(RESPONSIVE_PAGES).toHaveLength(20);
  });

  test("each persona passes the page's guard; personas 5 / 8 / 7", () => {
    for (const { pattern, persona } of RESPONSIVE_PAGES) {
      const guard = pages.find((page) => page.pattern === pattern)?.guard;
      expect(guard && PERSONAS[guard], pattern).toContain(persona);
    }
    const count = (persona: Persona) =>
      RESPONSIVE_PAGES.filter((page) => page.persona === persona).length;
    expect([count("guest"), count("member"), count("organizer")]).toEqual([
      5, 8, 7,
    ]);
  });

  test("the dynamic patterns are routeParams' 7 keys: 2 token pages, 5 from responsive-targets", () => {
    const dynamic = RESPONSIVE_PAGES.map(({ pattern }) => pattern).filter((p) =>
      p.includes("["),
    );
    expect(dynamic.sort()).toEqual(Object.keys(routeParams).sort());
    expect(dynamic.filter((p) => p.endsWith("[token]"))).toHaveLength(2);
  });
});

describe("matcher self-test", () => {
  const listOf = (classes: string): ClassList => ({
    file: "x.tsx",
    line: 1,
    tokens: classes.split(" "),
  });
  const parsed = (code: string) =>
    classLists(
      "x.tsx",
      ts.createSourceFile(
        "x.tsx",
        code,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      ),
    );

  test("an outline removal fails; one with the full focus-visible ring passes", () => {
    expect(outlineProblems(listOf("font-bold focus:outline-none"))).toEqual([
      "x.tsx:1 focus:outline-none",
    ]);
    expect(
      outlineProblems(listOf("outline-hidden focus-visible:outline-2")),
    ).toHaveLength(1);
    expect(
      outlineProblems(
        listOf(
          "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        ),
      ),
    ).toEqual([]);
    expect(
      outlineProblems(
        listOf(
          "outline-0 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
        ),
      ),
    ).toEqual([]);
  });

  test("motion without motion-safe: fails, at any variant", () => {
    expect(
      motionProblems(
        listOf(
          "transition-opacity hover:duration-200 starting:opacity-0 animate-spin",
        ),
      ),
    ).toHaveLength(4);
    expect(
      motionProblems(
        listOf(
          "motion-safe:transition-opacity motion-safe:starting:opacity-0 motion-safe:duration-200",
        ),
      ),
    ).toEqual([]);
  });

  test("class lists come from className, cn / *Classes arguments and same-file constants", () => {
    const lists = parsed(`
      const RING = "outline-none";
      const a = <p className="focus:outline-none" />;
      const b = <p className={cn("x", flag ? "transition" : "y")} />;
      const c = navLinkClasses(RING);
    `);
    const tokens = lists.flatMap((list) => list.tokens);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "focus:outline-none",
        "transition",
        "outline-none",
      ]),
    );
  });

  test("a height handed to a kit button fails", () => {
    const source = ts.createSourceFile(
      "x.tsx",
      `const a = <Button className="h-10 w-full" />; const b = buttonClasses("primary", "max-sm:min-h-14");`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    expect(buttonOverrides("x.tsx", source)).toEqual([
      "x.tsx h-10",
      "x.tsx max-sm:min-h-14",
    ]);
  });
});
