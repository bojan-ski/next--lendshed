import ts from "typescript";
import { calleeName, walk } from "@/__tests__/support/ast";
import { parseFile, sourceFiles } from "@/__tests__/support/import-graph";

// Every loan status change locks the item, then the loan, and no `user` row
// (rules/data.md, spec 14): the five transitions through
// lockLoanForTransition, the item sweeps under lockOwnItem. A false positive
// is fixed in the matcher with its reason, never by an exemption list.

const WRITES = new Set([
  "update",
  "updateMany",
  "create",
  "createMany",
  "upsert",
  "delete",
  "deleteMany",
]);

// The named function a node sits in, through arrows and callbacks (the
// transaction body is an arrow inside the data function).
function namedFunction(node: ts.Node): ts.FunctionDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current && !(ts.isFunctionDeclaration(current) && current.name)) {
    current = current.parent;
  }
  return (current as ts.FunctionDeclaration | undefined) ?? null;
}

// `x.<delegate>.<method>(…)` with a write method → the call.
function delegateWrite(
  node: ts.Node,
  delegate: string,
): node is ts.CallExpression {
  if (!ts.isCallExpression(node)) return false;
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    WRITES.has(callee.name.text) &&
    ts.isPropertyAccessExpression(callee.expression) &&
    callee.expression.name.text === delegate
  );
}

type Functions = Map<string, ts.FunctionDeclaration>;

function returnedValues(fn: ts.FunctionDeclaration): ts.Expression[] {
  const values: ts.Expression[] = [];
  walk(fn, (node) => {
    if (ts.isReturnStatement(node) && node.expression) {
      values.push(node.expression);
    }
  });
  return values;
}

// Whether a `data` value can set `status`. A literal answers by its keys, a
// conditional by either branch, and a call to a function declared in src/data/
// (`...seenAtFor(…)`) by what it returns; anything else might, so it counts.
function mayWriteStatus(
  expression: ts.Expression,
  functions: Functions,
): boolean {
  if (ts.isParenthesizedExpression(expression)) {
    return mayWriteStatus(expression.expression, functions);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      mayWriteStatus(expression.whenTrue, functions) ||
      mayWriteStatus(expression.whenFalse, functions)
    );
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) =>
      ts.isSpreadAssignment(property)
        ? mayWriteStatus(property.expression, functions)
        : property.name !== undefined && property.name.getText() === "status",
    );
  }
  if (ts.isCallExpression(expression)) {
    const fn = functions.get(calleeName(expression) ?? "");
    if (fn) {
      return returnedValues(fn).some((value) =>
        mayWriteStatus(value, functions),
      );
    }
  }
  return true;
}

// A change of status: update/updateMany. A create (insertLoanRequest) sets
// the first status of a row nobody else can hold yet.
function writesLoanStatus(
  call: ts.CallExpression,
  functions: Functions,
): boolean {
  if (!delegateWrite(call, "loan")) return false;
  const method = (call.expression as ts.PropertyAccessExpression).name.text;
  if (method !== "update" && method !== "updateMany") return false;
  const [args] = call.arguments;
  if (!args || !ts.isObjectLiteralExpression(args)) return true;
  const data = args.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && property.name.getText() === "data",
  );
  return data !== undefined && mayWriteStatus(data.initializer, functions);
}

type Guarded = {
  // "file#function" → the functions that write a loan status.
  writers: string[];
  // Writers that touch a loan before locking it.
  unlockedFirst: string[];
  // Every caller of a sweep, and those that run it before lockOwnItem.
  sweepCallers: string[];
  unguardedSweeps: string[];
  // Functions behind lockLoanForTransition that lock or write a `user` row.
  userLocks: string[];
  // The helper's raw SQL, in order.
  helperSql: string[];
};

const position = (node: ts.Node) => node.getStart();

function firstCall(fn: ts.Node, name: string): number | null {
  let found: number | null = null;
  walk(fn, (node) => {
    if (
      found === null &&
      ts.isCallExpression(node) &&
      calleeName(node) === name
    ) {
      found = position(node);
    }
  });
  return found;
}

function analyse(files: { file: string; source: ts.SourceFile }[]): Guarded {
  const result: Guarded = {
    writers: [],
    unlockedFirst: [],
    sweepCallers: [],
    unguardedSweeps: [],
    userLocks: [],
    helperSql: [],
  };
  const writers = new Map<
    string,
    { file: string; fn: ts.FunctionDeclaration | null }
  >();
  const functions: Functions = new Map();

  for (const { source } of files) {
    walk(source, (node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        functions.set(node.name.text, node);
      }
    });
  }
  for (const { file, source } of files) {
    walk(source, (node) => {
      if (ts.isCallExpression(node) && writesLoanStatus(node, functions)) {
        const fn = namedFunction(node);
        const name = `${file}#${fn?.name?.text ?? "<no function declaration>"}`;
        if (!writers.has(name)) writers.set(name, { file, fn });
      }
    });
  }
  result.writers = [...writers.keys()].sort();

  for (const [name, { file, fn }] of writers) {
    // An arrow at module level can't be traced to its callers: it fails the
    // writer set by name and counts as unlocked.
    if (!fn) {
      result.unlockedFirst.push(name);
      continue;
    }
    if (file.endsWith("/loans.ts")) {
      const lock = firstCall(fn, "lockLoanForTransition");
      let firstWrite: number | null = null;
      walk(fn, (node) => {
        if (firstWrite === null && delegateWrite(node, "loan")) {
          firstWrite = position(node);
        }
      });
      if (lock === null || firstWrite === null || lock > firstWrite) {
        result.unlockedFirst.push(name);
      }
      continue;
    }
    // A sweep outside loans.ts: every caller locks the item first.
    const sweep = fn.name!.text;
    for (const { file: callerFile, source } of files) {
      walk(source, (node) => {
        if (!ts.isCallExpression(node) || calleeName(node) !== sweep) return;
        const caller = namedFunction(node);
        if (!caller) return;
        result.sweepCallers.push(`${callerFile}#${caller.name!.text}`);
        const lock = firstCall(caller, "lockOwnItem");
        if (lock === null || lock > position(node)) {
          result.unguardedSweeps.push(`${callerFile}#${caller.name!.text}`);
        }
      });
    }
  }

  result.unlockedFirst.sort();

  const helper = functions.get("lockLoanForTransition");
  if (helper) {
    walk(helper, (node) => {
      if (ts.isTaggedTemplateExpression(node)) {
        result.helperSql.push(node.template.getText());
      }
    });
  }

  const transitionFns = [...functions.values()].filter(
    (fn) => fn === helper || firstCall(fn, "lockLoanForTransition") !== null,
  );
  for (const fn of transitionFns) {
    walk(fn, (node) => {
      const userSql =
        ts.isTaggedTemplateExpression(node) &&
        /"user"/.test(node.template.getText()) &&
        /\bFOR\b/.test(node.template.getText());
      const organizerLock =
        ts.isCallExpression(node) &&
        calleeName(node) === "lockActiveOrganizerIds";
      if (userSql || organizerLock || delegateWrite(node, "user")) {
        result.userLocks.push(fn.name!.text);
      }
    });
  }
  result.userLocks = [...new Set(result.userLocks)].sort();
  return result;
}

const order = (sql: string[], table: string) =>
  sql.findIndex((text) =>
    new RegExp(`FROM ${table}\\b.*FOR UPDATE`).test(text),
  );

describe("loan-lock-order — the matchers", () => {
  const probe = `
async function lockLoanForTransition(tx) {
  await tx.$queryRaw\`SELECT id FROM loan WHERE id = \${1} FOR UPDATE\`;
  await tx.$queryRaw\`SELECT id FROM item WHERE id = \${1} FOR UPDATE\`;
}
export async function guarded(tx) {
  await lockLoanForTransition(tx);
  await tx.loan.update({ where: { id: "x" }, data: { status: "out" } });
}
export async function writesFirst(tx) {
  await tx.loan.update({ where: { id: "x" }, data: { status: "out" } });
  await lockLoanForTransition(tx);
}
export async function lockedUser(tx) {
  await lockLoanForTransition(tx);
  await tx.$queryRaw\`SELECT id FROM "user" WHERE id = \${1} FOR SHARE\`;
  await tx.loan.updateMany({ where: {}, data: role ? { ownerSeenAt: now } : { status: "x" } });
}
function seenAtFor(party, now) {
  return party === "owner" ? { ownerSeenAt: now } : { borrowerSeenAt: now };
}
function statusOf(value) {
  return { status: value };
}
export async function seenOnly(db) {
  await db.loan.update({ where: { id: "x" }, data: role ? { ownerSeenAt: now } : { borrowerSeenAt: now } });
  await db.loan.update({ where: { id: "x" }, data: { ...seenAtFor(role, now) } });
}
export const arrowWriter = async (tx) => {
  await tx.loan.updateMany({ where: {}, data: { ...statusOf("x") } });
};
`;
  const source = ts.createSourceFile(
    "src/data/loans.ts",
    probe,
    ts.ScriptTarget.Latest,
    true,
  );
  const report = analyse([{ file: "src/data/loans.ts", source }]);

  test("finds status writers through conditionals, spreads and arrows, never a seen-at-only write", () => {
    expect(report.writers).toEqual([
      "src/data/loans.ts#<no function declaration>",
      "src/data/loans.ts#guarded",
      "src/data/loans.ts#lockedUser",
      "src/data/loans.ts#writesFirst",
    ]);
  });

  test("flags the write before the lock, the user lock and the loan-first SQL", () => {
    expect(report.unlockedFirst).toEqual([
      "src/data/loans.ts#<no function declaration>",
      "src/data/loans.ts#writesFirst",
    ]);
    expect(report.userLocks).toEqual(["lockedUser"]);
    expect(order(report.helperSql, "loan")).toBeLessThan(
      order(report.helperSql, "item"),
    );
  });
});

describe("loan-lock-order — src/data/", () => {
  const files = sourceFiles("src/data/**/*.ts")
    .filter((file) => !file.endsWith(".test.ts"))
    .map((file) => ({ file, source: parseFile(file) }));
  const report = analyse(files);

  test("the loan-status writers: the five transitions and the item sweep", () => {
    expect(report.writers).toEqual(
      [
        "src/data/items.ts#declineOpenRequests",
        "src/data/loans.ts#approveLoanRequest",
        "src/data/loans.ts#cancelLoanByParty",
        "src/data/loans.ts#declineLoanRequest",
        "src/data/loans.ts#handOverLoan",
        "src/data/loans.ts#markLoanBack",
      ].sort(),
    );
  });

  test("each transition calls lockLoanForTransition before its first loan write", () => {
    expect(report.unlockedFirst).toEqual([]);
  });

  test("the sweep runs only after lockOwnItem", () => {
    expect(report.sweepCallers.length).toBeGreaterThan(0);
    expect(report.unguardedSweeps).toEqual([]);
  });

  test("lockLoanForTransition locks the item, then the loan", () => {
    const item = order(report.helperSql, "item");
    const loan = order(report.helperSql, "loan");
    expect(item).toBeGreaterThanOrEqual(0);
    expect(loan).toBeGreaterThan(item);
  });

  test("nothing behind lockLoanForTransition locks or writes a user row", () => {
    expect(report.userLocks).toEqual([]);
  });
});
