import { readdirSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { calleeName, walk } from "@/__tests__/support/ast";
import { parseFile, REPO_ROOT } from "@/__tests__/support/import-graph";

// "One transaction", proven by structure: every write reachable from the six
// Stage E workflow functions goes through the transaction client their
// `$transaction` callback receives, never `db`, and the outbox drain
// (`deletePendingBlobs`) runs only after the transaction has resolved.
// Rollback-on-throw is proven at runtime by the tests of 18, 19 and 20
// (src/data/members.test.ts, items.test.ts, loans.test.ts), not repeated here.

const ENTRIES = [
  "src/data/members.ts#suspendMemberAccount",
  "src/data/members.ts#reinstateMemberAccount",
  "src/data/members.ts#deleteOwnUser",
  "src/data/members.ts#deleteMemberAccount",
  "src/data/loans.ts#closeLoanByOrganizer",
  "src/data/items.ts#retireItemByOrganizer",
];

// The post-commit drain of the deletion outbox: it writes through `db` by
// design (a file is deleted only once nothing references it), so it is the
// one write allowed outside the transaction, and only after it resolves.
const OUTBOX_DRAIN = "deletePendingBlobs";

const WRITE_METHODS = new Set([
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "$executeRaw",
  "$executeRawUnsafe",
]);
const RAW_METHODS = new Set(["$queryRaw", "$queryRawUnsafe"]);
// A raw query writes when its statement starts with a write keyword
// ("SELECT … FOR UPDATE" is a lock, not a write).
const RAW_WRITE = /^\s*(INSERT|UPDATE|DELETE)\b/i;

type FunctionNode =
  ts.FunctionDeclaration | ts.ArrowFunction | ts.FunctionExpression;

type Sources = Record<string, string>;

type Report = {
  violations: string[];
  txWrites: number;
  drains: { insideTransaction: boolean; afterTransaction: boolean }[];
};

function dataFiles(): string[] {
  const root = path.join(REPO_ROOT, "src/data");
  return readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((file) => `src/data/${file.split(path.sep).join("/")}`)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

// Top-level functions per file: declarations and `const name = (…) => …`.
function functionsOf(source: ts.SourceFile): Map<string, FunctionNode> {
  const functions = new Map<string, FunctionNode>();
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (
          ts.isIdentifier(declaration.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        ) {
          functions.set(declaration.name.text, init);
        }
      }
    }
  }
  return functions;
}

// `@/data/x` or `./x` → "src/data/x.ts".
function importsOf(source: ts.SourceFile): Map<string, string> {
  const imports = new Map<string, string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = (statement.moduleSpecifier as ts.StringLiteral).text;
    const match = /^(?:@\/data\/|\.\/)(.+)$/.exec(specifier);
    const bindings = statement.importClause?.namedBindings;
    if (!match || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      imports.set(element.name.text, `src/data/${match[1]}.ts`);
    }
  }
  return imports;
}

// The leftmost identifier of `a.b.c`, or null.
function rootOf(expression: ts.Expression): string | null {
  let current: ts.Expression = expression;
  while (
    ts.isPropertyAccessExpression(current) ||
    ts.isCallExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current)
  ) {
    current = ts.isCallExpression(current)
      ? current.expression
      : current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function isWrite(call: ts.CallExpression): boolean {
  if (!ts.isPropertyAccessExpression(call.expression)) return false;
  const method = call.expression.name.text;
  if (WRITE_METHODS.has(method)) return true;
  if (RAW_METHODS.has(method)) {
    const argument = call.arguments[0];
    const text = argument
      ? argument.getText()
      : ts.isTaggedTemplateExpression(call.parent)
        ? call.parent.template.getText()
        : "";
    return RAW_WRITE.test(text.replace(/^`/, ""));
  }
  return false;
}

// A tagged `tx.$executeRaw\`…\`` is a TaggedTemplateExpression, not a call.
function taggedWrite(node: ts.TaggedTemplateExpression): string | null {
  if (!ts.isPropertyAccessExpression(node.tag)) return null;
  const method = node.tag.name.text;
  const text = node.template.getText().replace(/^`/, "");
  if (method === "$executeRaw" || method === "$executeRawUnsafe") {
    return rootOf(node.tag.expression);
  }
  if (RAW_METHODS.has(method) && RAW_WRITE.test(text)) {
    return rootOf(node.tag.expression);
  }
  return null;
}

function isTransactionCall(call: ts.CallExpression): FunctionNode | null {
  if (calleeName(call) !== "$transaction") return null;
  const callback = call.arguments[0];
  return callback &&
    (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))
    ? callback
    : null;
}

const paramName = (fn: FunctionNode, index: number) => {
  const param = fn.parameters[index];
  return param && ts.isIdentifier(param.name) ? param.name.text : null;
};

// `walk`, except that a visitor returning "skip" stops the descent there.
function traverse(node: ts.Node, visit: (node: ts.Node) => "skip" | void) {
  if (visit(node) === "skip") return;
  ts.forEachChild(node, (child) => traverse(child, visit));
}

function analyzeWorkflow(entry: string, sources: Sources = {}): Report {
  const files = new Map<
    string,
    {
      source: ts.SourceFile;
      functions: Map<string, FunctionNode>;
      imports: Map<string, string>;
    }
  >();
  const load = (file: string) => {
    if (!files.has(file)) {
      const source = parseFile(file, sources);
      files.set(file, {
        source,
        functions: functionsOf(source),
        imports: importsOf(source),
      });
    }
    return files.get(file)!;
  };
  const resolve = (file: string, name: string) => {
    const own = load(file);
    if (own.functions.has(name)) return { file, fn: own.functions.get(name)! };
    const target = own.imports.get(name);
    if (!target) return null;
    try {
      const fn = load(target).functions.get(name);
      return fn ? { file: target, fn } : null;
    } catch {
      return null;
    }
  };

  const report: Report = { violations: [], txWrites: 0, drains: [] };
  const [entryFile, entryName] = entry.split("#");
  const entryFn = load(entryFile).functions.get(entryName);
  if (!entryFn) {
    report.violations.push(`${entry} not found`);
    return report;
  }

  type Context = {
    tx: string | null;
    insideTransaction: boolean;
    // The call in the entry function that led here, for the drain check.
    entryCall: ts.CallExpression | null;
    transactionEnd: number | null;
    stack: string[];
  };

  const visit = (file: string, body: ts.Node, label: string, ctx: Context) => {
    traverse(body, (node) => {
      if (ts.isTaggedTemplateExpression(node)) {
        const root = taggedWrite(node);
        if (root !== null) {
          if (ctx.tx !== null && root === ctx.tx) report.txWrites++;
          else report.violations.push(`${label}: raw write through ${root}`);
        }
        return;
      }
      if (!ts.isCallExpression(node)) return;

      const callback = isTransactionCall(node);
      if (callback) {
        const tx = paramName(callback, 0);
        if (callback.body) {
          visit(file, callback.body, `${label} › $transaction`, {
            ...ctx,
            tx,
            insideTransaction: true,
          });
        }
        // The callback was visited with its own client; never again as outer code.
        return "skip";
      }

      if (isWrite(node)) {
        const root = rootOf(
          (node.expression as ts.PropertyAccessExpression).expression,
        );
        if (ctx.tx !== null && root === ctx.tx) report.txWrites++;
        else {
          report.violations.push(
            `${label}: ${node.expression.getText()} writes through ${root ?? "?"}`,
          );
        }
        return;
      }

      const name = calleeName(node);
      if (!name || !ts.isIdentifier(node.expression)) return;
      const entryCall = ctx.entryCall ?? node;
      if (name === OUTBOX_DRAIN) {
        report.drains.push({
          insideTransaction: ctx.insideTransaction,
          afterTransaction:
            ctx.transactionEnd !== null &&
            entryCall.getStart() > ctx.transactionEnd,
        });
        return;
      }
      const target = resolve(file, name);
      if (!target) return;
      const key = `${target.file}#${name}`;
      if (ctx.stack.includes(key)) return;
      const txIndex = node.arguments.findIndex(
        (argument) => ts.isIdentifier(argument) && argument.text === ctx.tx,
      );
      if (target.fn.body) {
        visit(target.file, target.fn.body, `${label} › ${name}`, {
          tx: txIndex >= 0 ? paramName(target.fn, txIndex) : null,
          insideTransaction: ctx.insideTransaction,
          entryCall,
          transactionEnd: ctx.transactionEnd,
          stack: [...ctx.stack, key],
        });
      }
    });
  };

  // Where the entry's own `$transaction` call ends: a drain must start after it.
  let transactionEnd: number | null = null;
  walk(entryFn, (node) => {
    if (ts.isCallExpression(node) && isTransactionCall(node)) {
      transactionEnd = node.getEnd();
    }
  });
  if (entryFn.body) {
    visit(entryFile, entryFn.body, entry, {
      tx: null,
      insideTransaction: false,
      entryCall: null,
      transactionEnd,
      stack: [entry],
    });
  }
  return report;
}

describe("the matcher", () => {
  const fixture = (body: string): Sources => ({
    "src/data/fixture.ts": `
      import { db } from "@/db";
      async function deletePendingBlobs(keys: string[]) {
        await db.pendingBlobDeletion.deleteMany({ where: {} });
      }
      async function helper(client: Tx, id: string) {
        await client.loan.update({ where: { id }, data: {} });
      }
      export async function entry(id: string) {
        ${body}
      }
    `,
  });
  const analyze = (body: string) =>
    analyzeWorkflow("src/data/fixture.ts#entry", fixture(body));

  test("accepts writes through the callback's client, followed into helpers", () => {
    const report = analyze(`
      const keys = await db.$transaction(async (tx) => {
        await helper(tx, id);
        await tx.$queryRaw\`SELECT id FROM item WHERE id = \${id} FOR UPDATE\`;
        return [];
      });
      await deletePendingBlobs(keys);
    `);
    expect(report.violations).toEqual([]);
    expect(report.txWrites).toBe(1);
    expect(report.drains).toEqual([
      { insideTransaction: false, afterTransaction: true },
    ]);
  });

  test("flags a db write inside the callback, a write in a helper not given the client, and a raw update", () => {
    const report = analyze(`
      await db.$transaction(async (tx) => {
        await db.loan.update({ where: { id }, data: {} });
        await helper(db, id);
        await tx.$executeRaw\`UPDATE loan SET status = 'x'\`;
        await db.$queryRaw\`UPDATE loan SET status = 'y'\`;
      });
    `);
    expect(report.violations).toHaveLength(3);
    expect(report.txWrites).toBe(1);
  });

  test("flags a drain inside the callback", () => {
    const report = analyze(`
      await db.$transaction(async (tx) => {
        await deletePendingBlobs([id]);
      });
    `);
    expect(report.drains).toEqual([
      { insideTransaction: true, afterTransaction: false },
    ]);
  });
});

describe.each(ENTRIES)("%s", (entry) => {
  const report = analyzeWorkflow(entry);

  test("every reachable write goes through the transaction client", () => {
    expect(report.violations).toEqual([]);
    expect(report.txWrites).toBeGreaterThan(0);
  });

  test("the outbox drain, when reached, runs only after the transaction resolves", () => {
    for (const drain of report.drains) {
      expect(drain).toEqual({
        insideTransaction: false,
        afterTransaction: true,
      });
    }
  });
});

test("the deletions and the organizer retire reach the drain; suspension, reinstatement and close do not", () => {
  const reaching = ENTRIES.filter(
    (entry) => analyzeWorkflow(entry).drains.length > 0,
  ).sort();
  expect(reaching).toEqual(
    [
      "src/data/items.ts#retireItemByOrganizer",
      "src/data/members.ts#deleteMemberAccount",
      "src/data/members.ts#deleteOwnUser",
    ].sort(),
  );
});

test("the entries are the six workflow functions in the data layer", () => {
  expect(ENTRIES).toHaveLength(6);
  for (const entry of ENTRIES) {
    const [file] = entry.split("#");
    expect(dataFiles()).toContain(file);
  }
});
