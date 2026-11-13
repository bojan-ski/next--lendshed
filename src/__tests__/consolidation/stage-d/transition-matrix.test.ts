import { refresh } from "next/cache";
import { inventoryRows } from "@/__tests__/support/action-inventory";
import {
  createLoanFixture,
  createLoanParties,
  FIXTURE_INSTANT,
  type LoanFixtureOptions,
  type LoanParties,
  loanRow,
} from "@/__tests__/support/loan-fixtures";
import {
  expectRefused as expectRefusedRun,
  runAs,
  type Transition,
  TRANSITIONS,
  transitionForm,
} from "@/__tests__/support/loan-transitions";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import * as loanActions from "@/actions/loans";
import { getLoanForViewer } from "@/data/loans";
import { addDays, communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { loanStatus } from "@/lib/text/status";
import type { EffectiveLoanStatus } from "@/types/loan";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/feedback/flash", () => ({ setFlash: vi.fn() }));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// Every loan transition × actor × effective status (Stage D exit condition):
// the action accepts exactly the oracle's cells, a refusal writes nothing, and
// the page offers a control exactly where its action would accept it. The
// oracle is the Loan Lifecycle and the inventory's Auth column, nothing else.

type Actor = keyof LoanParties;

const STATUSES = Object.keys(loanStatus) as EffectiveLoanStatus[];
const ACTORS: Actor[] = ["owner", "borrower", "member", "organizer"];

type Cell = {
  transition: Transition;
  actor: Actor;
  status: EffectiveLoanStatus;
  // Only for hand over: the loan starts on or before today, nothing else holds the item.
  startsByToday?: boolean;
  itemHeld?: boolean;
};

function accepts({
  transition,
  actor,
  status,
  startsByToday = true,
  itemHeld = false,
}: Cell): boolean {
  switch (transition) {
    case "approveLoan":
    case "declineLoan":
      return actor === "owner" && status === "requested";
    case "cancelLoan":
      return (
        (actor === "borrower" &&
          (status === "requested" || status === "approved")) ||
        (actor === "owner" && status === "approved")
      );
    case "markLoanOut":
      return (
        actor === "owner" && status === "approved" && startsByToday && !itemHeld
      );
    case "markLoanReturned":
      return actor === "owner" && (status === "out" || status === "overdue");
  }
}

const scope = createTestScope();
let parties: LoanParties;
let today: string;

beforeAll(async () => {
  // One frozen instant: actions and fixtures agree on today all run long.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date());
  today = communityToday();
  await assertMigrated();
  parties = await createLoanParties(scope);
});
afterAll(async () => {
  vi.useRealTimers();
  await scope.cleanup();
});

const fixture = (status: EffectiveLoanStatus, options?: LoanFixtureOptions) =>
  createLoanFixture(scope, parties, status, today, options);

// The stage the screen would show (14's mismatch rule is 14's own test).
const form = (
  transition: Transition,
  id: string,
  status: EffectiveLoanStatus,
  overrides?: Record<string, string>,
) => transitionForm(transition, id, status, today, overrides);

const act = (transition: Transition, actor: Actor, data: FormData) =>
  runAs(parties[actor], transition, data);

// What the page offers this actor on a loan in this state.
async function offered(actor: Actor, loanId: string) {
  const detail = await getLoanForViewer(parties[actor], loanId, today);
  return detail && detail.actions;
}

const expectRefused = (
  transition: Transition,
  actor: Actor,
  loanId: string,
  data: FormData,
  outcome?: object,
) =>
  expectRefusedRun(
    () => act(transition, actor, data),
    loanId,
    parties.owner.id,
    outcome,
  );

async function expectAccepted(
  transition: Transition,
  actor: "owner" | "borrower",
  loanId: string,
  data: FormData,
) {
  const state = await act(transition, actor, data);
  const after = await loanRow(loanId);
  const { flash, target } = TRANSITIONS[transition];
  expect(state).toEqual({ flash });
  expect(after.status).toBe(target);
  expect(after.changedAt.getTime()).toBeGreaterThan(FIXTURE_INSTANT.getTime());
  const [own, other] =
    actor === "owner"
      ? [after.ownerSeenAt, after.borrowerSeenAt]
      : [after.borrowerSeenAt, after.ownerSeenAt];
  expect(own).toEqual(after.changedAt);
  expect(other).toEqual(FIXTURE_INSTANT);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(setFlash).not.toHaveBeenCalled();
}

describe("the derived dimensions", () => {
  test("the transitions are the loan actions whose inventory input has an id", () => {
    const loanExports = new Set(Object.keys(loanActions));
    const withId = inventoryRows()
      .filter(
        ({ name, input }) => loanExports.has(name) && /\bid\b/.test(input),
      )
      .map(({ name }) => name)
      .sort();
    expect(withId).toEqual(Object.keys(TRANSITIONS).sort());
  });

  test("the statuses are loanStatus's nine keys", () => {
    expect([...STATUSES].sort()).toEqual(
      [
        "approved",
        "cancelled",
        "declined",
        "expired",
        "lapsed",
        "out",
        "overdue",
        "requested",
        "returned",
      ].sort(),
    );
  });
});

const CELLS = (Object.keys(TRANSITIONS) as Transition[]).flatMap((transition) =>
  STATUSES.flatMap((status) =>
    ACTORS.map((actor) => ({ transition, actor, status })),
  ),
);

describe.each(Object.keys(TRANSITIONS) as Transition[])("%s", (transition) => {
  // One loan per status for the refusals (they write nothing, which each cell
  // asserts) and a twin that only the page reads.
  const refusal = {} as Record<EffectiveLoanStatus, string>;
  const twin = {} as Record<EffectiveLoanStatus, string>;
  beforeAll(async () => {
    await Promise.all(
      STATUSES.map(async (status) => {
        refusal[status] = (await fixture(status)).id;
        twin[status] = (await fixture(status)).id;
      }),
    );
  });

  test.each(CELLS.filter((cell) => cell.transition === transition))(
    "$actor on $status",
    async (cell) => {
      const { actor, status } = cell;
      const actions = await offered(actor, twin[status]);
      if (actor === "member") expect(actions).toBeNull();
      expect(actions?.includes(TRANSITIONS[transition].entry) ?? false).toBe(
        accepts(cell),
      );

      if (!accepts(cell)) {
        await expectRefused(
          transition,
          actor,
          refusal[status],
          form(transition, refusal[status], status),
        );
        return;
      }
      // A fresh loan no page has read, so the actor's seen-at can only come
      // from the transition.
      const { id } = await fixture(status);
      await expectAccepted(
        transition,
        actor as "owner" | "borrower",
        id,
        form(transition, id, status),
      );
    },
  );
});

describe("date edges", () => {
  test("a request starting today is offered and approved", async () => {
    const twin = await fixture("requested", { startOffset: 0 });
    expect(await offered("owner", twin.id)).toContain("approve");
    const { id } = await fixture("requested", { startOffset: 0 });
    await expectAccepted(
      "approveLoan",
      "owner",
      id,
      form("approveLoan", id, "requested"),
    );
  });

  test("a request that started yesterday is expired: not offered, stale", async () => {
    const { id } = await fixture("expired", { startOffset: -1 });
    expect(await offered("owner", id)).toEqual([]);
    await expectRefused(
      "approveLoan",
      "owner",
      id,
      form("approveLoan", id, "expired"),
    );
  });

  test("an approval starting tomorrow is not offered for hand over, and stale", async () => {
    const { id } = await fixture("approved", { startOffset: 1 });
    const cell = {
      transition: "markLoanOut",
      actor: "owner",
      status: "approved",
      startsByToday: false,
    } as const;
    expect((await offered("owner", id))?.includes("hand_over")).toBe(
      accepts(cell),
    );
    await expectRefused(
      "markLoanOut",
      "owner",
      id,
      form("markLoanOut", id, "approved"),
    );
  });

  test.each([
    ["the day before the start", -2],
    ["tomorrow", 1],
  ])(
    "returnedOn %s → fieldErrors.returnedOn, nothing written",
    async (_, offset) => {
      // An out loan starting yesterday: start − 1 is two days ago.
      const { id } = await fixture("out");
      await expectRefused(
        "markLoanReturned",
        "owner",
        id,
        form("markLoanReturned", id, "out", {
          returnedOn: addDays(today, offset),
        }),
        { fieldErrors: { returnedOn: expect.any(Array) } },
      );
    },
  );
});

describe("OQ-34: another loan still out holds the item", () => {
  test("handOverBlocked, no hand_over, and markLoanOut is stillOut with nothing written", async () => {
    const { id, itemId } = await fixture("approved");
    await scope.createLoan({
      itemId,
      borrowerId: parties.member.id,
      status: "out",
      startDate: addDays(today, -8),
      endDate: addDays(today, -6),
    });
    const detail = await getLoanForViewer(parties.owner, id, today);
    expect(detail?.handOverBlocked).toBe(true);
    const cell = {
      transition: "markLoanOut",
      actor: "owner",
      status: "approved",
      itemHeld: true,
    } as const;
    expect(detail?.actions.includes("hand_over")).toBe(accepts(cell));
    expect(detail?.actions).toEqual(["cancel"]);
    await expectRefused(
      "markLoanOut",
      "owner",
      id,
      form("markLoanOut", id, "approved"),
      {
        formError: "stillOut",
      },
    );
  });
});

// The organizer row above is a non-party; owning the item makes them the owner.
describe("an organizer who owns the item", () => {
  test("is offered approve and the action accepts it", async () => {
    const asOwner = { ...parties, owner: parties.organizer };
    const twin = await createLoanFixture(scope, asOwner, "requested", today);
    expect(
      (await getLoanForViewer(parties.organizer, twin.id, today))?.actions,
    ).toContain("approve");

    const { id } = await createLoanFixture(scope, asOwner, "requested", today);
    expect(
      await runAs(
        parties.organizer,
        "approveLoan",
        form("approveLoan", id, "requested"),
      ),
    ).toEqual({ flash: "loanApproved" });
    expect((await loanRow(id)).status).toBe("approved");
  });
});

// Approve also needs a Listed item and a borrower (14): the owner may still
// decline, and the page offers exactly that.
describe.each<[string, LoanFixtureOptions]>([
  ["a Hidden item", { itemStatus: "hidden" }],
  ["no borrower", { borrowerId: null }],
])("a request on %s", (_, options) => {
  test("offers decline alone; approve is stale, decline is accepted", async () => {
    const twin = await fixture("requested", options);
    expect(await offered("owner", twin.id)).toEqual(["decline"]);

    const refused = await fixture("requested", options);
    await expectRefused(
      "approveLoan",
      "owner",
      refused.id,
      form("approveLoan", refused.id, "requested"),
    );

    const { id } = await fixture("requested", options);
    const state = await act(
      "declineLoan",
      "owner",
      form("declineLoan", id, "requested"),
    );
    expect(state).toEqual({ flash: "loanDeclined" });
    expect((await loanRow(id)).status).toBe("declined");
  });
});
