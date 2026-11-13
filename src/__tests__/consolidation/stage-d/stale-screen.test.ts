import { refresh } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  createLoanFixture,
  createLoanParties,
  type LoanParties,
} from "@/__tests__/support/loan-fixtures";
import {
  expectRefused,
  runAs,
  type Transition,
  TRANSITIONS,
  transitionForm,
} from "@/__tests__/support/loan-transitions";
import { html } from "@/__tests__/support/prerender-html";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { requestLoan } from "@/actions/loans";
import ItemDetailSection from "@/components/items/ItemDetailSection";
import LoanDetailSection from "@/components/loans/LoanDetailSection";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { addDays, communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { status as statusText } from "@/strings/status";
import { loanActions } from "@/strings/loanActions";
import type { EffectiveLoanStatus } from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/feedback/flash", () => ({ setFlash: vi.fn() }));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// A transition from a screen that no longer matches the loan is refused
// `stale`, writes nothing, and the page then shows the loan as it is now. The
// islands' rendering of `errors.stale` is pinned by 14/15's RTL tests.

const scope = createTestScope();
let parties: LoanParties;
let today: string;

beforeAll(async () => {
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

type Party = "owner" | "borrower";

const run = (
  party: Party,
  transition: Transition,
  id: string,
  status: EffectiveLoanStatus,
  overrides?: Record<string, string>,
) =>
  runAs(
    parties[party],
    transition,
    transitionForm(transition, id, status, today, overrides),
  );

async function succeed(...args: Parameters<typeof run>) {
  const state = await run(...args);
  expect(state).toEqual({ flash: TRANSITIONS[args[1]].flash });
  vi.clearAllMocks();
}

async function loanPage(viewer: ViewerDTO, id: string): Promise<string> {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  return html(await LoanDetailSection({ params: Promise.resolve({ id }) }));
}

// Every loan status label the page shows (icon, then the label's text).
const statusLabels = (page: string) =>
  Object.values(statusText.loan).filter((label) =>
    page.includes(`</svg>${label}</span>`),
  );

const button = (label: string) => new RegExp(`<button[^>]*>${label}</button>`);

// The control the refused transition would have shown.
const CONTROL: Record<Transition, string[]> = {
  approveLoan: [loanActions.approve],
  declineLoan: [loanActions.decline],
  cancelLoan: [loanActions.cancelRequest, loanActions.cancelLoan],
  markLoanOut: [loanActions.handOver],
  markLoanReturned: [loanActions.markBack],
};

async function expectCurrentState(
  party: Party,
  id: string,
  refused: Transition,
  shown: EffectiveLoanStatus,
  stillOffered: string[] = [],
) {
  const page = await loanPage(parties[party], id);
  expect(statusLabels(page)).toEqual([statusText.loan[shown]]);
  for (const label of CONTROL[refused]) expect(page).not.toMatch(button(label));
  for (const label of stillOffered) expect(page).toMatch(button(label));
}

describe("the repeat: the same call again is stale", () => {
  test.each<[Transition, Party, EffectiveLoanStatus]>([
    ["approveLoan", "owner", "requested"],
    ["declineLoan", "owner", "requested"],
    ["cancelLoan", "borrower", "approved"],
    ["markLoanOut", "owner", "approved"],
    ["markLoanReturned", "owner", "out"],
  ])("%s by the %s from %s", async (transition, party, status) => {
    const { id } = await createLoanFixture(scope, parties, status, today);
    await succeed(party, transition, id, status);
    await expectRefused(
      () => run(party, transition, id, status),
      id,
      parties.owner.id,
    );
    await expectCurrentState(
      party,
      id,
      transition,
      TRANSITIONS[transition].target,
    );
  });
});

describe("the competing change committed first", () => {
  test("approve after the borrower's cancel", async () => {
    const { id } = await createLoanFixture(scope, parties, "requested", today);
    await succeed("borrower", "cancelLoan", id, "requested");
    await expectRefused(
      () => run("owner", "approveLoan", id, "requested"),
      id,
      parties.owner.id,
    );
    await expectCurrentState("owner", id, "approveLoan", "cancelled");
  });

  test("decline after approve", async () => {
    const { id } = await createLoanFixture(scope, parties, "requested", today);
    await succeed("owner", "approveLoan", id, "requested");
    await expectRefused(
      () => run("owner", "declineLoan", id, "requested"),
      id,
      parties.owner.id,
    );
    // The approved loan's own control renders, so an absent one is real
    // (it starts tomorrow, so there is no hand over yet).
    await expectCurrentState("owner", id, "declineLoan", "approved", [
      loanActions.cancelLoan,
    ]);
  });

  test("cancel after hand over", async () => {
    const { id } = await createLoanFixture(scope, parties, "approved", today);
    await succeed("owner", "markLoanOut", id, "approved");
    await expectRefused(
      () => run("borrower", "cancelLoan", id, "approved"),
      id,
      parties.owner.id,
    );
    await expectCurrentState("borrower", id, "cancelLoan", "out");
  });

  test("hand over after the owner's cancel", async () => {
    const { id } = await createLoanFixture(scope, parties, "approved", today);
    await succeed("owner", "cancelLoan", id, "approved");
    await expectRefused(
      () => run("owner", "markLoanOut", id, "approved"),
      id,
      parties.owner.id,
    );
    await expectCurrentState("owner", id, "markLoanOut", "cancelled");
  });

  test("mark returned after another mark returned", async () => {
    const { id } = await createLoanFixture(scope, parties, "out", today);
    await succeed("owner", "markLoanReturned", id, "out", { asLent: "no" });
    await expectRefused(
      () => run("owner", "markLoanReturned", id, "out"),
      id,
      parties.owner.id,
    );
    await expectCurrentState("owner", id, "markLoanReturned", "returned");
  });

  test("approve after an overlapping approval swept the request", async () => {
    const first = await createLoanFixture(scope, parties, "requested", today);
    const { id } = await scope.createLoan({
      itemId: first.itemId,
      borrowerId: parties.member.id,
      status: "requested",
      startDate: addDays(today, 2),
      endDate: addDays(today, 3),
    });
    await succeed("owner", "approveLoan", first.id, "requested");
    expect(await db.loan.findUniqueOrThrow({ where: { id } })).toMatchObject({
      status: "declined",
      systemReason: "dates_taken",
    });
    await expectRefused(
      () => run("owner", "approveLoan", id, "requested"),
      id,
      parties.owner.id,
    );
    await expectCurrentState("owner", id, "approveLoan", "declined");
  });
});

describe("requestLoan from a form rendered while the item was requestable", () => {
  const expectNotFound = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => {
        throw new Error("expected not-found");
      },
      (thrown: unknown) => thrown,
    );
    expect((error as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  };

  test.each<[string, (item: string, owner: string) => Promise<unknown>]>([
    [
      "the owner hid it",
      (item) =>
        db.item.update({ where: { id: item }, data: { status: "hidden" } }),
    ],
    [
      "the owner retired it",
      (item) =>
        db.item.update({
          where: { id: item },
          data: { status: "retired", retiredAt: new Date() },
        }),
    ],
    [
      "the owner was suspended",
      (_, owner) =>
        db.user.update({ where: { id: owner }, data: { status: "suspended" } }),
    ],
  ])("after %s → stale, no loan, no redirect", async (_, change) => {
    const owner = await scope.createTestUser({ contactDetails: "Phone" });
    const { id: itemId } = await scope.createItem({
      ownerId: owner.id,
      status: "listed",
      photo: true,
    });
    await change(itemId, owner.id);

    vi.mocked(getViewer).mockResolvedValue(parties.borrower);
    const data = new FormData();
    data.set("itemId", itemId);
    data.set("startDate", addDays(today, 1));
    data.set("endDate", addDays(today, 2));
    data.set("message", "");
    const state = await requestLoan({}, data).catch((error: unknown) => {
      if (isRedirectError(error)) throw new Error("redirected");
      throw error;
    });

    expect(state).toMatchObject({ formError: "stale" });
    expect(await db.loan.count({ where: { itemId } })).toBe(0);
    expect(setFlash).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    await expectNotFound(
      ItemDetailSection({ params: Promise.resolve({ id: itemId }) }),
    );
  });
});
