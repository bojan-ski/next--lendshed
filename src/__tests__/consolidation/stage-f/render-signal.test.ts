import ts from "typescript";
import {
  actionFunctions,
  inventoryRows,
  leadingRole,
  serverActionExports,
} from "@/__tests__/support/action-inventory";
import { walk } from "@/__tests__/support/ast";
import { parseFile, sourceFiles } from "@/__tests__/support/import-graph";
import {
  RENDER_SIGNALS,
  type RenderSignal,
} from "@/__tests__/support/lifecycle-edges";
import { flash } from "@/strings/flash";

// The one re-render signal each action fires, derived from its source (spec 24):
// `updateTag("categories")`, `refresh()`, `setFlash` + `redirect`, `redirect`
// alone, or nothing. A signal call is a top-level statement of its function
// after the last refusal `return`, so no refusal path reaches it. The runtime
// "once on success, none on refusal" assertions live with each action's tests.

type SignalCall = "refresh" | "updateTag" | "setFlash" | "redirect";

const SIGNAL_SOURCES: Record<SignalCall, string> = {
  refresh: "next/cache",
  updateTag: "next/cache",
  setFlash: "@/lib/feedback/flash",
  redirect: "next/navigation",
};

// Local name → the signal it imports (an alias still counts).
function signalImports(source: ts.SourceFile): Map<string, SignalCall> {
  const names = new Map<string, SignalCall>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    const from = (statement.moduleSpecifier as ts.StringLiteral).text;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (
        imported in SIGNAL_SOURCES &&
        SIGNAL_SOURCES[imported as SignalCall] === from
      ) {
        names.set(element.name.text, imported as SignalCall);
      }
    }
  }
  return names;
}

const signalOf = (
  call: ts.Node,
  names: Map<string, SignalCall>,
): SignalCall | null =>
  ts.isCallExpression(call) && ts.isIdentifier(call.expression)
    ? (names.get(call.expression.text) ?? null)
    : null;

// The statement a signal call stands as, when it is one on its own
// (`refresh();`, `await setFlash(…);`).
function statementOf(call: ts.CallExpression): ts.Statement | null {
  const inner = ts.isAwaitExpression(call.parent) ? call.parent : call;
  return ts.isExpressionStatement(inner.parent) ? inner.parent : null;
}

function kindOf(calls: Set<SignalCall>): RenderSignal | string {
  const has = (...wanted: SignalCall[]) =>
    calls.size === wanted.length && wanted.every((call) => calls.has(call));
  if (calls.size === 0) return "none";
  if (has("updateTag")) return "updateTag";
  if (has("refresh")) return "refresh";
  if (has("setFlash", "redirect")) return "flashRedirect";
  if (has("redirect")) return "redirect";
  return `mixed (${[...calls].sort().join(" + ")})`;
}

type ActionSignal = { kind: RenderSignal | string; problems: string[] };

// Every exported action of one "use server" source.
function actionSignals(source: ts.SourceFile): Map<string, ActionSignal> {
  const names = signalImports(source);
  const result = new Map<string, ActionSignal>();
  for (const [action, functions] of actionFunctions(source)) {
    const calls = new Set<SignalCall>();
    const problems: string[] = [];
    for (const fn of functions) {
      const fnName = fn.name?.text ?? "?";
      const statements = fn.body?.statements ?? ts.factory.createNodeArray();
      walk(fn, (node) => {
        const signal = signalOf(node, names);
        if (!signal) return;
        calls.add(signal);
        const statement = statementOf(node as ts.CallExpression);
        const index = statement ? statements.indexOf(statement) : -1;
        if (index === -1) {
          problems.push(
            `${fnName}: ${signal}() is not a top-level statement of its body`,
          );
          return;
        }
        // Only further signal statements, then at most the success return.
        statements.slice(index + 1).forEach((after, offset, rest) => {
          const isSignal =
            ts.isExpressionStatement(after) &&
            signalOf(
              ts.isAwaitExpression(after.expression)
                ? after.expression.expression
                : after.expression,
              names,
            ) !== null;
          const isFinalReturn =
            ts.isReturnStatement(after) && offset === rest.length - 1;
          if (!isSignal && !isFinalReturn) {
            problems.push(
              `${fnName}: ${signal}() is followed by "${after.getText(source).split("\n")[0]}"`,
            );
          }
        });
      });
    }
    result.set(action, { kind: kindOf(calls), problems });
  }
  return result;
}

const derived = new Map<string, ActionSignal>();
for (const file of new Set(serverActionExports().map(({ file }) => file))) {
  for (const [action, signal] of actionSignals(parseFile(file))) {
    derived.set(action, signal);
  }
}
const rows = inventoryRows();
const sorted = (values: Iterable<string>) => [...values].sort();

test("RENDER_SIGNALS has one entry per exported action", () => {
  expect(sorted(Object.keys(RENDER_SIGNALS))).toEqual(
    sorted(serverActionExports().map(({ name }) => name)),
  );
  expect(sorted(derived.keys())).toEqual(sorted(Object.keys(RENDER_SIGNALS)));
});

test("each action's derived signal is its RENDER_SIGNALS entry", () => {
  const kinds = Object.fromEntries(
    [...derived].map(([action, { kind }]) => [action, kind]),
  );
  expect(kinds).toEqual(RENDER_SIGNALS);
});

test("the tally is 3 updateTag, 19 refresh, 8 flashRedirect, 2 redirect, 2 none", () => {
  const tally: Record<string, number> = {};
  for (const { kind } of derived.values()) tally[kind] = (tally[kind] ?? 0) + 1;
  expect(tally).toEqual({
    updateTag: 3,
    refresh: 19,
    flashRedirect: 8,
    redirect: 2,
    none: 2,
  });
});

test("every signal call is a top-level statement after the last refusal return", () => {
  const problems = [...derived].flatMap(([action, signal]) =>
    signal.problems.map((problem) => `${action} → ${problem}`),
  );
  expect(problems).toEqual([]);
});

test("refresh from next/cache is imported only under src/actions/", () => {
  const importers = sourceFiles("src/**/*.{ts,tsx}")
    .filter(
      (file) =>
        !file.startsWith("src/__tests__/") && !/\.test\.tsx?$/.test(file),
    )
    .filter((file) => {
      const names = signalImports(parseFile(file));
      return [...names.values()].includes("refresh");
    });
  expect(importers.length).toBeGreaterThan(0);
  expect(importers.filter((file) => !file.startsWith("src/actions/"))).toEqual(
    [],
  );
});

describe("the inventory's cells agree", () => {
  const kindOfRow = (name: string) => RENDER_SIGNALS[name];

  // A cell's own `\|` is text: split on it and cancelLoan's Input cell would
  // spill into its Auth cell (spec 24 found its Auth read as "`loan`").
  test("every row parses to its five cells, an escaped pipe kept inside its cell", () => {
    const empty = rows.flatMap(({ name, input, auth, revalidates, result }) =>
      Object.entries({ input, auth, revalidates, result })
        .filter(([, cell]) => !cell)
        .map(([column]) => `${name}.${column}`),
    );
    expect(empty).toEqual([]);
    const cancel = rows.find(({ name }) => name === "cancelLoan");
    expect(cancel?.input).toContain("`request` | `loan`");
    expect(leadingRole(cancel?.auth ?? "")).toBe(
      "borrower (requested/approved) or owner (approved)",
    );
  });

  test("Revalidates names `categories` exactly for the updateTag rows", () => {
    const naming = rows
      .filter(({ revalidates }) => revalidates.includes("`categories`"))
      .map(({ name }) => name);
    expect(sorted(naming)).toEqual(
      sorted(
        rows
          .filter(({ name }) => kindOfRow(name) === "updateTag")
          .map(({ name }) => name),
      ),
    );
    for (const { name, revalidates } of rows) {
      if (kindOfRow(name) !== "updateTag") expect(revalidates).toMatch(/^—/);
    }
  });

  test('Result says "redirect" exactly for the flashRedirect and redirect rows', () => {
    const redirecting = rows
      .filter(({ result }) => /\bredirect\b/.test(result))
      .map(({ name }) => name);
    expect(sorted(redirecting)).toEqual(
      sorted(
        rows
          .filter(({ name }) =>
            ["flashRedirect", "redirect"].includes(kindOfRow(name)),
          )
          .map(({ name }) => name),
      ),
    );
  });

  test("every flashRedirect row names a flash key", () => {
    const keys = new Set(Object.keys(flash));
    const unnamed = rows
      .filter(({ name }) => kindOfRow(name) === "flashRedirect")
      .filter(
        ({ result }) =>
          ![...result.matchAll(/`(\w+)`/g)].some(([, key]) => keys.has(key)),
      )
      .map(({ name }) => name);
    expect(unnamed).toEqual([]);
  });

  test("the two none rows say no `refresh()`", () => {
    const none = rows.filter(({ name }) => kindOfRow(name) === "none");
    expect(none.map(({ name }) => name).sort()).toEqual([
      "changePassword",
      "createResetLink",
    ]);
    for (const { result } of none) expect(result).toContain("no `refresh()`");
  });
});

describe("the matcher catches what it guards (self-test)", () => {
  const header = [
    '"use server";',
    'import { refresh, updateTag } from "next/cache";',
    'import { redirect as go } from "next/navigation";',
    'import { setFlash } from "@/lib/feedback/flash";',
  ].join("\n");
  const signalsOf = (body: string) =>
    actionSignals(
      ts.createSourceFile(
        "src/actions/sample.ts",
        `${header}\n${body}`,
        ts.ScriptTarget.Latest,
        true,
      ),
    );

  test("a clean action, an aliased redirect and a private helper are read", () => {
    const signals = signalsOf(`
      export async function a(state, form) {
        if (!form) return { formError: "stale" };
        refresh();
        return { flash: "x" };
      }
      export async function b() {
        if (bad) return { formError: "stale" };
        await setFlash("x");
        go("/");
      }
      export async function c() { return helper(); }
      async function helper() {
        if (bad) return { formError: "stale" };
        updateTag("categories");
        return {};
      }
      export async function d() { return { created: true }; }
    `);
    expect(Object.fromEntries([...signals].map(([k, v]) => [k, v]))).toEqual({
      a: { kind: "refresh", problems: [] },
      b: { kind: "flashRedirect", problems: [] },
      c: { kind: "updateTag", problems: [] },
      d: { kind: "none", problems: [] },
    });
  });

  test("two signal kinds in one action are mixed", () => {
    const signals = signalsOf(`
      export async function a() {
        updateTag("categories");
        refresh();
        return {};
      }
    `);
    expect(signals.get("a")?.kind).toBe("mixed (refresh + updateTag)");
  });

  test("a refusal return after a signal fails", () => {
    const signals = signalsOf(`
      export async function a() {
        refresh();
        if (bad) return { formError: "stale" };
        return {};
      }
    `);
    expect(signals.get("a")?.problems).toEqual([
      'a: refresh() is followed by "if (bad) return { formError: "stale" };"',
    ]);
  });

  test.each([
    ["inside an if", "if (ok) refresh();"],
    ["inside a try", "try { refresh(); } catch {}"],
    ["inside a catch", "try { work(); } catch { refresh(); }"],
    ["as an expression", "const done = refresh();"],
  ])("a signal %s fails", (_, statement) => {
    const signals = signalsOf(`
      export async function a() {
        ${statement}
        return {};
      }
    `);
    expect(signals.get("a")?.problems).toEqual([
      "a: refresh() is not a top-level statement of its body",
    ]);
  });

  test("a same-named call from another module is not a signal", () => {
    const signals = actionSignals(
      ts.createSourceFile(
        "src/actions/sample.ts",
        `"use server";\nimport { refresh } from "@/lib/other";\nexport async function a() { refresh(); return {}; }`,
        ts.ScriptTarget.Latest,
        true,
      ),
    );
    expect(signals.get("a")?.kind).toBe("none");
  });
});
