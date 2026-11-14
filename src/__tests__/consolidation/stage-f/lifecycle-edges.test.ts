import { existsSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  actionFunctions,
  inventoryRows,
  serverActionExports,
} from "@/__tests__/support/action-inventory";
import { calleeName, importedNames, walk } from "@/__tests__/support/ast";
import {
  parseFile,
  readSource,
  REPO_ROOT,
} from "@/__tests__/support/import-graph";
import {
  BLOCK_LIFECYCLES,
  coveragePath,
  driverTokens,
  GONE,
  LIFECYCLE_EDGES,
  type Lifecycle,
  type LifecycleEdge,
  NONE,
  STATES,
  workflowBlocks,
} from "@/__tests__/support/lifecycle-edges";
import { DAILY_JOB_STEPS } from "@/data/daily-job";
import { LoanSystemReason } from "@/generated/prisma/enums";

// The five lifecycle diagrams (project-data.md → Workflows) against the edge
// registry, the actions inventory and the code (spec 24, checks 1–7). The
// diagrams are the source; a disagreement is fixed in whichever is wrong.

const ACTION_TOKEN = /\b[a-z]+(?:[A-Z][a-z0-9]*)+\b/g;
const REASON_TOKEN = /\b[a-z]+(?:_[a-z]+)+\b/g;

const tokensOf = (text: string, pattern: RegExp) =>
  new Set(text.match(pattern) ?? []);
const sorted = (values: Iterable<string>) => [...new Set(values)].sort();
const minus = (a: Iterable<string>, b: Set<string>) =>
  sorted([...a].filter((value) => !b.has(value)));

const label = ({ lifecycle, from, to, driver }: LifecycleEdge) =>
  `${lifecycle} ${from} → ${to} (${driverTokens({ lifecycle, from, to, driver, coveredBy: [] }).join(", ")})`;

const actionDrivers = (edges: LifecycleEdge[]) =>
  new Set(
    edges.flatMap(({ driver }) =>
      driver.kind === "action" ? [driver.action] : [],
    ),
  );

// Check 1: every camelCase token in a diagram is an exported action.
function unknownTokens(
  blocks: Record<string, string>,
  exported: Set<string>,
): string[] {
  return Object.entries(blocks).flatMap(([heading, block]) =>
    minus(tokensOf(block, ACTION_TOKEN), exported).map(
      (token) => `${heading}: unknown token ${token}`,
    ),
  );
}

// Check 2: a diagram's action tokens are exactly its lifecycles' action drivers.
function driverMismatches(
  blocks: Record<string, string>,
  edges: LifecycleEdge[],
): string[] {
  return Object.entries(blocks).flatMap(([heading, block]) => {
    const lifecycles = BLOCK_LIFECYCLES[heading] ?? [];
    const drawn = tokensOf(block, ACTION_TOKEN);
    const driven = actionDrivers(
      edges.filter(({ lifecycle }) => lifecycles.includes(lifecycle)),
    );
    return [
      ...minus(drawn, driven).map(
        (token) => `${heading}: ${token} is drawn but drives no edge`,
      ),
      ...minus(driven, drawn).map(
        (token) => `${heading}: ${token} drives an edge but is not drawn`,
      ),
    ];
  });
}

// Check 7: every edge names a covering file that exists and names its driver.
function coverageGaps(
  edges: LifecycleEdge[],
  exists: (file: string) => boolean,
  read: (file: string) => string,
  tokensFor: (edge: LifecycleEdge) => string[] = driverTokens,
): string[] {
  return edges.flatMap((edge) => {
    if (edge.coveredBy.length === 0)
      return [`${label(edge)}: no covering file`];
    const tokens = tokensFor(edge);
    return edge.coveredBy.flatMap((entry) => {
      const file = coveragePath(entry);
      if (!exists(file)) return [`${label(edge)}: ${file} does not exist`];
      const source = read(file);
      return tokens.some((token) => new RegExp(`\\b${token}\\b`).test(source))
        ? []
        : [`${label(edge)}: ${file} names none of ${tokens.join(", ")}`];
    });
  });
}

// A data-layer suite proves an action's edge through the data function the
// action calls (`hideItem` → `hideOwnItem`), never through the action's name:
// so an action's tokens include the `@/data/*` functions its body calls.
function dataLayerCalls(): Map<string, string[]> {
  const calls = new Map<string, string[]>();
  const files = new Set(serverActionExports().map(({ file }) => file));
  for (const file of files) {
    const source = parseFile(file);
    const fromData = importedNames(source, (specifier) =>
      specifier.startsWith("@/data/"),
    );
    for (const [action, functions] of actionFunctions(source)) {
      const names = functions.flatMap((fn) => {
        const found: string[] = [];
        walk(fn, (node) => {
          if (!ts.isCallExpression(node)) return;
          const name = calleeName(node);
          if (name && fromData.has(name)) found.push(name);
        });
        return found;
      });
      calls.set(action, sorted(names));
    }
  }
  return calls;
}

const blocks = workflowBlocks();
const exported = new Set(serverActionExports().map(({ name }) => name));
const dataCalls = dataLayerCalls();
const edgeTokens = (edge: LifecycleEdge) =>
  driverTokens(edge).flatMap((token) => [
    token,
    ...(dataCalls.get(token) ?? []),
  ]);
const drawnActions = new Set(
  Object.values(blocks).flatMap((block) => [...tokensOf(block, ACTION_TOKEN)]),
);
const blockOf = (lifecycle: Lifecycle) => {
  const heading = Object.keys(BLOCK_LIFECYCLES).find((key) =>
    BLOCK_LIFECYCLES[key].includes(lifecycle),
  );
  return heading ? (blocks[heading] ?? "") : "";
};

test("the diagrams are the five lifecycle blocks under Workflows", () => {
  expect(sorted(Object.keys(blocks))).toEqual(
    sorted(Object.keys(BLOCK_LIFECYCLES)),
  );
});

test("1. every camelCase token in a diagram is an exported action", () => {
  expect(unknownTokens(blocks, exported)).toEqual([]);
});

test("2. each diagram's action tokens are its lifecycles' action drivers", () => {
  expect(driverMismatches(blocks, LIFECYCLE_EDGES)).toEqual([]);
});

describe("3. the Loan diagram's reasons", () => {
  const autoEdges = LIFECYCLE_EDGES.flatMap(({ driver }) =>
    driver.kind === "auto" ? [driver] : [],
  );

  test("are LoanSystemReason's members, which are the auto edges' reasons", () => {
    const enumReasons = sorted(Object.values(LoanSystemReason));
    expect(
      sorted(tokensOf(blocks["Loan Lifecycle"] ?? "", REASON_TOKEN)),
    ).toEqual(enumReasons);
    expect(sorted(autoEdges.map(({ reason }) => reason))).toEqual(enumReasons);
  });

  test("every action an auto or outbox edge names drives an action edge", () => {
    const named = LIFECYCLE_EDGES.flatMap(({ driver }) =>
      driver.kind === "auto" || driver.kind === "outbox" ? driver.actions : [],
    );
    expect(minus(named, actionDrivers(LIFECYCLE_EDGES))).toEqual([]);
  });
});

describe("4. every action is placed", () => {
  test("the actions no diagram draws are exactly the nine non-lifecycle actions", () => {
    expect(minus(exported, drawnActions)).toEqual(
      sorted([
        "signIn",
        "signOut",
        "changePassword",
        "updateProfile",
        "updateContactDetails",
        "updateItem",
        "createCategory",
        "renameCategory",
        "deleteCategory",
      ]),
    );
  });

  test("drawn ∪ non-lifecycle = the exports = the inventory's names", () => {
    const placed = [...drawnActions, ...minus(exported, drawnActions)];
    expect(sorted(placed)).toEqual(sorted(exported));
    expect(sorted(exported)).toEqual(
      sorted(inventoryRows().map(({ name }) => name)),
    );
  });

  test("no registry edge names a non-lifecycle action", () => {
    const named = LIFECYCLE_EDGES.flatMap((edge) =>
      driverTokens(edge).filter((token) => exported.has(token)),
    );
    expect(minus(named, drawnActions)).toEqual([]);
  });
});

describe("5. the states", () => {
  test("every endpoint is in its lifecycle's state set (or none / gone)", () => {
    const strays = LIFECYCLE_EDGES.flatMap((edge) => {
      const states = STATES[edge.lifecycle];
      return [
        ...(edge.from === NONE || states.includes(edge.from)
          ? []
          : [`${label(edge)}: from ${edge.from}`]),
        ...(edge.to === GONE || states.includes(edge.to)
          ? []
          : [`${label(edge)}: to ${edge.to}`]),
      ];
    });
    expect(strays).toEqual([]);
  });

  test.each<Lifecycle>(["loan", "item", "member", "invitation", "resetGrant"])(
    "every %s state ends an edge and is drawn in its block",
    (lifecycle) => {
      const edges = LIFECYCLE_EDGES.filter(
        (edge) => edge.lifecycle === lifecycle,
      );
      const endpoints = new Set(edges.flatMap(({ from, to }) => [from, to]));
      const block = blockOf(lifecycle).toLowerCase();
      expect(minus(STATES[lifecycle], endpoints)).toEqual([]);
      expect(
        STATES[lifecycle].filter(
          (state) => !new RegExp(`\\b${state.toLowerCase()}\\b`).test(block),
        ),
      ).toEqual([]);
    },
  );
});

describe("6. job and derived edges", () => {
  const steps = new Set<string>(DAILY_JOB_STEPS);

  test("every job step and stored-by step is a daily-job step", () => {
    const named = LIFECYCLE_EDGES.flatMap(({ driver }) =>
      driver.kind === "job"
        ? [driver.step]
        : driver.kind === "derived" && driver.storedBy
          ? [driver.storedBy]
          : [],
    );
    expect(named.length).toBeGreaterThan(0);
    expect(minus(named, steps)).toEqual([]);
  });

  const derived = LIFECYCLE_EDGES.flatMap((edge) =>
    edge.driver.kind === "derived"
      ? [{ ...edge, storedBy: edge.driver.storedBy }]
      : [],
  );

  test("the Loan lifecycle's derived edges are expired, lapsed and overdue", () => {
    expect(
      derived
        .filter(({ lifecycle }) => lifecycle === "loan")
        .map(({ from, to, storedBy }) => [from, to, storedBy]),
    ).toEqual([
      ["requested", "expired", "storeExpired"],
      ["approved", "lapsed", "storeLapsed"],
      ["out", "overdue", null],
    ]);
  });

  test("elsewhere only invitation and grant expiry are derived, then purged by the job", () => {
    const purge: Partial<Record<Lifecycle, string>> = {
      invitation: "purgeInvitations",
      resetGrant: "purgeResetGrants",
    };
    const others = derived.filter(({ lifecycle }) => lifecycle !== "loan");
    expect(
      others.map(({ lifecycle, from, to, storedBy }) => [
        lifecycle,
        from,
        to,
        storedBy,
      ]),
    ).toEqual([
      ["invitation", "open", "expired", null],
      ["resetGrant", "open", "expired", null],
    ]);
    for (const { lifecycle } of others) {
      expect(
        LIFECYCLE_EDGES.filter(
          (edge) =>
            edge.lifecycle === lifecycle &&
            edge.from === "expired" &&
            edge.to === GONE,
        ).map(({ driver }) => driver),
      ).toEqual([{ kind: "job", step: purge[lifecycle] }]);
    }
  });
});

test("7. every edge names covering files that exist and name its driver", () => {
  expect(
    coverageGaps(
      LIFECYCLE_EDGES,
      (file) => existsSync(path.join(REPO_ROOT, file)),
      (file) => readSource(file),
      edgeTokens,
    ),
  ).toEqual([]);
});

test("every action the diagrams draw calls at least one data-layer function", () => {
  expect(
    sorted(drawnActions).filter((action) => !dataCalls.get(action)?.length),
  ).toEqual([]);
});

describe("the matchers catch what they guard (self-test)", () => {
  const edge: LifecycleEdge = {
    lifecycle: "loan",
    from: NONE,
    to: "requested",
    driver: { kind: "action", action: "requestLoan" },
    coveredBy: ["actions/loans"],
  };
  const block = { "Loan Lifecycle": "requestLoan → requested" };

  test("an unknown token fails check 1, naming it", () => {
    expect(
      unknownTokens(
        { "Loan Lifecycle": "requestLoan → requested (lastError)" },
        exported,
      ),
    ).toEqual(["Loan Lifecycle: unknown token lastError"]);
    expect(unknownTokens(block, exported)).toEqual([]);
  });

  test("a missing driver fails check 2 in both directions", () => {
    expect(driverMismatches(block, [edge])).toEqual([]);
    expect(driverMismatches(block, [])).toEqual([
      "Loan Lifecycle: requestLoan is drawn but drives no edge",
    ]);
    expect(driverMismatches({ "Loan Lifecycle": "requested" }, [edge])).toEqual(
      ["Loan Lifecycle: requestLoan drives an edge but is not drawn"],
    );
  });

  test("a missing, absent or silent coverage file fails check 7", () => {
    const read = () => "requestLoan";
    expect(coverageGaps([edge], () => true, read)).toEqual([]);
    expect(
      coverageGaps([{ ...edge, coveredBy: [] }], () => true, read),
    ).toEqual([`${label(edge)}: no covering file`]);
    expect(coverageGaps([edge], () => false, read)).toEqual([
      `${label(edge)}: src/actions/loans.test.ts does not exist`,
    ]);
    expect(
      coverageGaps(
        [edge],
        () => true,
        () => "approveLoan",
      ),
    ).toEqual([
      `${label(edge)}: src/actions/loans.test.ts names none of requestLoan`,
    ]);
  });

  test("the token pattern takes camelCase names, not PascalCase or snake_case", () => {
    expect(
      sorted(
        tokensOf(
          "UploadLog markLoanOut item_hidden WebP deletePendingBlobs",
          ACTION_TOKEN,
        ),
      ),
    ).toEqual(["deletePendingBlobs", "markLoanOut"]);
    expect(
      sorted(
        tokensOf("auto (dates_taken, item_hidden) → declined", REASON_TOKEN),
      ),
    ).toEqual(["dates_taken", "item_hidden"]);
  });
});
