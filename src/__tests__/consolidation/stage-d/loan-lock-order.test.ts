import ts from "typescript";
import { calleeName, walk } from "@/__tests__/support/ast";
import { parseFile, sourceFiles } from "@/__tests__/support/import-graph";

// Every loan status change locks the item, then the loan, and no `user` row
// after them (rules/data.md, spec 14): the transitions through
// lockLoanForTransition, the item sweeps under an item lock. A transition that
// writes a `user` FK (19's close sets `closedById`) takes a key-share on that
// row, so it calls lockActiveOrganizerIds before lockLoanForTransition (spec
// 19). A false positive is fixed in the matcher with its reason, never by an
// exemption list.

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

// Loan columns that reference `user` (the schema's borrowerId and closedById;
// an actor column is named `…ById`). Writing one takes a key-share lock on
// that user row.
const USER_FK = /^(borrowerId|\w+ById)$/;

// Whether a `data` value can set a `user` FK, read the way mayWriteStatus reads
// `status`: an unknown expression might, so it counts.
function mayWriteUserFk(
  expression: ts.Expression,
  functions: Functions,
): boolean {
  if (ts.isParenthesizedExpression(expression)) {
    return mayWriteUserFk(expression.expression, functions);
  }
  if (ts.isConditionalExpression(expression)) {
    return (
      mayWriteUserFk(expression.whenTrue, functions) ||
      mayWriteUserFk(expression.whenFalse, functions)
    );
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) =>
      ts.isSpreadAssignment(property)
        ? mayWriteUserFk(property.expression, functions)
        : property.name !== undefined && USER_FK.test(property.name.getText()),
    );
  }
  if (ts.isCallExpression(expression)) {
    const fn = functions.get(calleeName(expression) ?? "");
    if (fn) {
      return returnedValues(fn).some((value) =>
        mayWriteUserFk(value, functions),
      );
    }
  }
  return true;
}

function writesLoanUserFk(node: ts.Node, functions: Functions): boolean {
  if (!delegateWrite(node, "loan")) return false;
  const [args] = node.arguments;
  if (!args || !ts.isObjectLiteralExpression(args)) return true;
  const data = args.properties.find(
    (property): property is ts.PropertyAssignment =>
      ts.isPropertyAssignment(property) && property.name.getText() === "data",
  );
  return data !== undefined && mayWriteUserFk(data.initializer, functions);
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
  // Every caller of a sweep, and those that run it before any item lock.
  sweepCallers: string[];
  unguardedSweeps: string[];
  // Functions whose raw SQL locks item rows FOR UPDATE.
  itemLockers: string[];
  // Functions that lock or write a `user` row after lockLoanForTransition.
  userLocks: string[];
  // Transitions writing a `user` FK without the organizer locks taken before
  // lockLoanForTransition.
  unlockedFkWrites: string[];
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
    itemLockers: [],
    userLocks: [],
    unlockedFkWrites: [],
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

  // Derived, never listed: a function whose raw SQL locks item rows FOR UPDATE.
  const itemLockers = [...functions.entries()]
    .filter(([, fn]) => {
      let locks = false;
      walk(fn, (node) => {
        if (
          ts.isTaggedTemplateExpression(node) &&
          /FROM item\b[\s\S]*FOR UPDATE/.test(node.template.getText())
        ) {
          locks = true;
        }
      });
      return locks;
    })
    .map(([name]) => name);
  result.itemLockers = itemLockers.sort();

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
    // A sweep outside loans.ts: every caller locks the item rows first, with
    // any item-lock helper (one owner's item, or a suspended member's items).
    const sweep = fn.name!.text;
    for (const { file: callerFile, source } of files) {
      walk(source, (node) => {
        if (!ts.isCallExpression(node) || calleeName(node) !== sweep) return;
        const caller = namedFunction(node);
        if (!caller) return;
        result.sweepCallers.push(`${callerFile}#${caller.name!.text}`);
        const locks = itemLockers
          .map((locker) => firstCall(caller, locker))
          .filter((at): at is number => at !== null);
        if (locks.length === 0 || Math.min(...locks) > position(node)) {
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
    // Inside the helper everything counts as behind the loan lock.
    const loanLock =
      fn === helper ? -1 : firstCall(fn, "lockLoanForTransition")!;
    const organizerLock = firstCall(fn, "lockActiveOrganizerIds");
    walk(fn, (node) => {
      const userSql =
        ts.isTaggedTemplateExpression(node) &&
        /"user"/.test(node.template.getText()) &&
        /\bFOR\b/.test(node.template.getText());
      const organizerLockCall =
        ts.isCallExpression(node) &&
        calleeName(node) === "lockActiveOrganizerIds";
      if (
        (userSql || organizerLockCall || delegateWrite(node, "user")) &&
        position(node) > loanLock
      ) {
        result.userLocks.push(fn.name!.text);
      }
      if (
        writesLoanUserFk(node, functions) &&
        (organizerLock === null || organizerLock > loanLock)
      ) {
        result.unlockedFkWrites.push(fn.name!.text);
      }
    });
  }
  result.userLocks = [...new Set(result.userLocks)].sort();
  result.unlockedFkWrites = [...new Set(result.unlockedFkWrites)].sort();
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
export async function fkGuarded(tx) {
  await lockActiveOrganizerIds(tx);
  await lockLoanForTransition(tx);
  await tx.loan.update({ where: { id: "x" }, data: { status: "returned", closedById: "a" } });
}
export async function fkUnguarded(tx) {
  await lockLoanForTransition(tx);
  await tx.loan.update({ where: { id: "x" }, data: { status: "returned", closedById: "a" } });
}
export async function fkLateLock(tx) {
  await lockLoanForTransition(tx);
  await lockActiveOrganizerIds(tx);
  await tx.loan.update({ where: { id: "x" }, data: { status: "returned", ...closer("a") } });
}
function closer(id) {
  return { closedById: id };
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
      "src/data/loans.ts#fkGuarded",
      "src/data/loans.ts#fkLateLock",
      "src/data/loans.ts#fkUnguarded",
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
    expect(report.userLocks).toEqual(["fkLateLock", "lockedUser"]);
    expect(order(report.helperSql, "loan")).toBeLessThan(
      order(report.helperSql, "item"),
    );
  });

  test("flags a user-FK write unless the organizer locks come before the loan lock", () => {
    expect(report.unlockedFkWrites).toEqual(["fkLateLock", "fkUnguarded"]);
  });
});

describe("loan-lock-order — src/data/", () => {
  const files = sourceFiles("src/data/**/*.ts")
    .filter((file) => !file.endsWith(".test.ts"))
    .map((file) => ({ file, source: parseFile(file) }));
  const report = analyse(files);

  test("the loan-status writers: the six transitions, the two item sweeps and the member sweep", () => {
    expect(report.writers).toEqual(
      [
        "src/data/items.ts#declineOpenRequests",
        "src/data/items.ts#sweepOrganizerRetiredLoans",
        "src/data/loans.ts#approveLoanRequest",
        "src/data/loans.ts#cancelLoanByParty",
        "src/data/loans.ts#closeLoanByOrganizer",
        "src/data/loans.ts#declineLoanRequest",
        "src/data/loans.ts#handOverLoan",
        "src/data/loans.ts#markLoanBack",
        "src/data/members.ts#sweepMemberLoans",
      ].sort(),
    );
  });

  test("each transition calls lockLoanForTransition before its first loan write", () => {
    expect(report.unlockedFirst).toEqual([]);
  });

  // lockDeletionItems (spec 20) is found the same way: it is wider than
  // lockMemberLoanItems because the user DELETE's FK cascade takes row locks on
  // every item it touches (owned, borrowed or closed under, retired), not by
  // any exemption.
  test("the item locks are found from their SQL", () => {
    expect(report.itemLockers).toEqual(
      expect.arrayContaining([
        "lockDeletionItems",
        "lockItemForOrganizer",
        "lockMemberLoanItems",
        "lockOwnItem",
      ]),
    );
  });

  test("every sweep runs only after an item lock", () => {
    expect(report.sweepCallers).toEqual(
      expect.arrayContaining([
        "src/data/items.ts#retireItemByOrganizer",
        "src/data/members.ts#runAccountDeletion",
        "src/data/members.ts#suspendMemberAccount",
      ]),
    );
    expect(report.unguardedSweeps).toEqual([]);
  });

  // Organizers → the member's user row → their items → the sweep.
  test("suspendMemberAccount locks in the documented order", () => {
    const [source] = files
      .filter(({ file }) => file === "src/data/members.ts")
      .map(({ source }) => source);
    let fn: ts.FunctionDeclaration | undefined;
    walk(source, (node) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "suspendMemberAccount"
      ) {
        fn = node;
      }
    });
    let memberRow: number | null = null;
    walk(fn!, (node) => {
      if (
        memberRow === null &&
        ts.isTaggedTemplateExpression(node) &&
        /FROM "user"[\s\S]*FOR UPDATE/.test(node.template.getText())
      ) {
        memberRow = position(node);
      }
    });
    const steps = [
      firstCall(fn!, "lockActiveOrganizerIds"),
      memberRow,
      firstCall(fn!, "lockMemberLoanItems"),
      firstCall(fn!, "sweepMemberLoans"),
    ];
    expect(steps.every((at) => at !== null)).toBe(true);
    expect([...steps].sort((a, b) => a! - b!)).toEqual(steps);
  });

  // Spec 20: organizers → the member's user row → (runAccountDeletion) items →
  // loans → grants → the user DELETE.
  const membersSource = () =>
    files.find(({ file }) => file === "src/data/members.ts")!.source;
  const functionNamed = (name: string) => {
    let fn: ts.FunctionDeclaration | undefined;
    walk(membersSource(), (node) => {
      if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node;
    });
    return fn!;
  };
  const firstMatch = (fn: ts.Node, test: (node: ts.Node) => boolean) => {
    let found: number | null = null;
    walk(fn, (node) => {
      if (found === null && test(node)) found = position(node);
    });
    return found;
  };
  const isMemberRowLock = (node: ts.Node) =>
    ts.isTaggedTemplateExpression(node) &&
    /FROM "user"[\s\S]*FOR UPDATE/.test(node.template.getText());

  test.each(["deleteOwnUser", "deleteMemberAccount"])(
    "%s takes the organizer locks, then the member row, then runs the deletion",
    (name) => {
      const fn = functionNamed(name);
      const steps = [
        firstCall(fn, "lockActiveOrganizerIds"),
        firstMatch(fn, isMemberRowLock),
        firstCall(fn, "runAccountDeletion"),
      ];
      expect(steps.every((at) => at !== null)).toBe(true);
      expect([...steps].sort((a, b) => a! - b!)).toEqual(steps);
    },
  );

  test("runAccountDeletion locks the items before any loan, item, grant or user write", () => {
    const fn = functionNamed("runAccountDeletion");
    const steps = [
      firstCall(fn, "lockDeletionItems"),
      firstCall(fn, "sweepMemberLoans"),
      firstCall(fn, "retireOrDeleteOwnerItems"),
      firstMatch(fn, (node) => delegateWrite(node, "passwordResetGrant")),
      firstMatch(fn, (node) => delegateWrite(node, "user")),
    ];
    expect(steps.every((at) => at !== null)).toBe(true);
    expect([...steps].sort((a, b) => a! - b!)).toEqual(steps);
    // Nothing but the lock may write before it.
    const lock = steps[0]!;
    for (const delegate of ["loan", "item", "invitation", "user"]) {
      const write = firstMatch(fn, (node) => delegateWrite(node, delegate));
      expect(write === null || write > lock, delegate).toBe(true);
    }
  });

  test("lockLoanForTransition locks the item, then the loan", () => {
    const item = order(report.helperSql, "item");
    const loan = order(report.helperSql, "loan");
    expect(item).toBeGreaterThanOrEqual(0);
    expect(loan).toBeGreaterThan(item);
  });

  test("nothing locks or writes a user row after lockLoanForTransition", () => {
    expect(report.userLocks).toEqual([]);
  });

  test("a transition writing a user FK takes the organizer locks before the loan lock", () => {
    expect(report.unlockedFkWrites).toEqual([]);
  });

  // Organizers → item → loan → the write (spec 19).
  test("closeLoanByOrganizer locks in the documented order", () => {
    const [source] = files
      .filter(({ file }) => file === "src/data/loans.ts")
      .map(({ source }) => source);
    let fn: ts.FunctionDeclaration | undefined;
    walk(source, (node) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.text === "closeLoanByOrganizer"
      ) {
        fn = node;
      }
    });
    let write: number | null = null;
    walk(fn!, (node) => {
      if (write === null && delegateWrite(node, "loan")) write = position(node);
    });
    const steps = [
      firstCall(fn!, "lockActiveOrganizerIds"),
      firstCall(fn!, "lockLoanForTransition"),
      write,
    ];
    expect(steps.every((at) => at !== null)).toBe(true);
    expect([...steps].sort((a, b) => a! - b!)).toEqual(steps);
  });
});
