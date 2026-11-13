import { isRedirectError } from "next/dist/client/components/redirect-error";
import ts from "typescript";
import { parseFile } from "@/__tests__/support/import-graph";
import {
  createLoanFixture,
  createLoanParties,
  type LoanParties,
  loanRow,
  ownerLoans,
} from "@/__tests__/support/loan-fixtures";
import {
  expectRefused,
  runAs,
  transitionForm,
} from "@/__tests__/support/loan-transitions";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { requestLoan } from "@/actions/loans";
import { fromDbDate } from "@/data/db-dates";
import { getViewer } from "@/data/viewer";
import { addDays, communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import type { RequestLoanState } from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/feedback/flash", () => ({ setFlash: vi.fn() }));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// The Build Stages exit condition for Stage D, through the actions: request →
// approve → hand over → mark as back, and every refusal the Stage D states
// declare. By reference: `unexpected` (stage-c/unexpected-reported and the
// action tests), concurrent approvals (14's test in src/data/loans.test.ts),
// the count agreement (needs-action-agreement), the browser journey (e2e).

// The formError kinds the four Stage D states declare, read from the types.
function declaredFormErrors(): Set<string> {
  const source = parseFile("src/types/loan.ts");
  const kinds = new Set<string>();
  const states = [
    "RequestLoanState",
    "LoanDecisionState",
    "HandOverState",
    "MarkReturnedState",
  ];
  for (const statement of source.statements) {
    if (
      !ts.isTypeAliasDeclaration(statement) ||
      !states.includes(statement.name.text) ||
      !ts.isTypeLiteralNode(statement.type)
    ) {
      continue;
    }
    for (const member of statement.type.members) {
      if (
        !ts.isPropertySignature(member) ||
        member.name.getText() !== "formError"
      )
        continue;
      const type = member.type!;
      const options = ts.isUnionTypeNode(type) ? type.types : [type];
      for (const option of options) {
        if (
          ts.isLiteralTypeNode(option) &&
          ts.isStringLiteral(option.literal)
        ) {
          kinds.add(option.literal.text);
        }
      }
    }
  }
  return kinds;
}

const scope = createTestScope();
const reached = new Set<string>();
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

const listedItem = async (ownerId = parties.owner.id) =>
  (
    await scope.createItem({
      ownerId,
      status: "listed",
      photo: true,
      maxLoanDays: 14,
    })
  ).id;

function requestForm(itemId: string, from: number, to: number): FormData {
  const data = new FormData();
  data.set("itemId", itemId);
  data.set("startDate", addDays(today, from));
  data.set("endDate", addDays(today, to));
  data.set("message", "");
  return data;
}

async function request(viewer: ViewerDTO, data: FormData) {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  return requestLoan({}, data);
}

// A refused request: the kind, and no loan anywhere on the owner's items.
async function expectRequestRefused(
  viewer: ViewerDTO,
  data: FormData,
  ownerId: string,
  formError: NonNullable<RequestLoanState["formError"]>,
) {
  const before = await ownerLoans(ownerId);
  expect(await request(viewer, data)).toMatchObject({ formError });
  expect(await ownerLoans(ownerId)).toEqual(before);
  expect(setFlash).not.toHaveBeenCalled();
  reached.add(formError);
}

const refused = (
  run: Parameters<typeof expectRefused>[0],
  loanId: string,
  formError: string,
) =>
  expectRefused(run, loanId, parties.owner.id, { formError }).then(() => {
    reached.add(formError);
  });

describe("the lending lifecycle", () => {
  test("request → approve → hand over → mark as back", async () => {
    const itemId = await listedItem();

    const error = await request(
      parties.borrower,
      requestForm(itemId, 0, 2),
    ).then(
      () => {
        throw new Error("expected a redirect");
      },
      (thrown: unknown) => thrown,
    );
    if (!isRedirectError(error)) throw error;
    const target = error.digest.split(";")[2];
    const [loan] = await ownerLoans(parties.owner.id).then((rows) =>
      rows.filter((row) => row.itemId === itemId),
    );
    expect(target).toBe(`/loans/${loan.id}`);
    expect(setFlash).toHaveBeenCalledWith("requestSent");
    expect(loan.status).toBe("requested");

    const owner = parties.owner;
    for (const [transition, status, flash] of [
      ["approveLoan", "requested", "loanApproved"],
      ["markLoanOut", "approved", "loanHandedOver"],
      ["markLoanReturned", "out", "loanReturned"],
    ] as const) {
      expect(
        await runAs(
          owner,
          transition,
          transitionForm(transition, loan.id, status, today),
        ),
      ).toEqual({ flash });
    }
    const back = await loanRow(loan.id);
    expect(back.status).toBe("returned");
    expect(back.returnedOn && fromDbDate(back.returnedOn)).toBe(today);
    expect(back.returnedAsLent).toBe("yes");

    // Ended: the same approval is now a stale screen.
    vi.clearAllMocks();
    await refused(
      () =>
        runAs(
          owner,
          "approveLoan",
          transitionForm("approveLoan", loan.id, "requested", today),
        ),
      loan.id,
      "stale",
    );
  });
});

describe("every refusal, nothing written", () => {
  test("needsContactDetails: a requester without contact details", async () => {
    const itemId = await listedItem();
    await expectRequestRefused(
      parties.member,
      requestForm(itemId, 1, 2),
      parties.owner.id,
      "needsContactDetails",
    );
  });

  test("itemLimit: a second open request on one item", async () => {
    const itemId = await listedItem();
    await scope.createLoan({
      itemId,
      borrowerId: parties.borrower.id,
      status: "requested",
      startDate: addDays(today, 1),
      endDate: addDays(today, 2),
    });
    await expectRequestRefused(
      parties.borrower,
      requestForm(itemId, 5, 6),
      parties.owner.id,
      "itemLimit",
    );
  });

  test("overallLimit: a sixth open request", async () => {
    const { id } = await scope.createTestUser({ contactDetails: "Phone" });
    const asker: ViewerDTO = { ...parties.borrower, id };
    for (let index = 0; index < 5; index += 1) {
      await scope.createLoan({
        itemId: await listedItem(),
        borrowerId: id,
        status: "requested",
        startDate: addDays(today, 1),
        endDate: addDays(today, 2),
      });
    }
    await expectRequestRefused(
      asker,
      requestForm(await listedItem(), 1, 2),
      parties.owner.id,
      "overallLimit",
    );
  });

  test("datesTaken on request: an approved loan holds the dates", async () => {
    const { itemId } = await createLoanFixture(
      scope,
      parties,
      "approved",
      today,
    );
    await expectRequestRefused(
      parties.borrower,
      requestForm(itemId, 1, 3),
      parties.owner.id,
      "datesTaken",
    );
  });

  test("datesTaken on approve: the exclusion constraint refuses an overlap", async () => {
    const blocked = await createLoanFixture(scope, parties, "requested", today);
    // Stored approved over the same days, written past every check.
    await scope.createLoan({
      itemId: blocked.itemId,
      borrowerId: parties.member.id,
      status: "approved",
      startDate: addDays(today, 2),
      endDate: addDays(today, 3),
    });
    await refused(
      () =>
        runAs(
          parties.owner,
          "approveLoan",
          transitionForm("approveLoan", blocked.id, "requested", today),
        ),
      blocked.id,
      "datesTaken",
    );
  });

  test("stillOut: an overdue loan holds the item until it is marked back", async () => {
    const overdue = await createLoanFixture(scope, parties, "overdue", today);
    const waiting = await scope.createLoan({
      itemId: overdue.itemId,
      borrowerId: parties.member.id,
      status: "approved",
      startDate: today,
      endDate: addDays(today, 1),
    });
    const handOver = () =>
      runAs(
        parties.owner,
        "markLoanOut",
        transitionForm("markLoanOut", waiting.id, "approved", today),
      );
    await refused(handOver, waiting.id, "stillOut");

    expect(
      await runAs(
        parties.owner,
        "markLoanReturned",
        transitionForm("markLoanReturned", overdue.id, "overdue", today),
      ),
    ).toEqual({ flash: "loanReturned" });
    expect(await handOver()).toEqual({ flash: "loanHandedOver" });
    expect((await loanRow(waiting.id)).status).toBe("out");
  });

  // Reads what the tests above reached: run with the whole file, never
  // filtered to one refusal (a `-t` filter leaves the set short).
  test("each declared formError kind but unexpected was reached once", () => {
    const declared = declaredFormErrors();
    declared.delete("unexpected");
    expect([...declared].sort()).toEqual([
      "datesTaken",
      "itemLimit",
      "needsContactDetails",
      "overallLimit",
      "stale",
      "stillOut",
    ]);
    expect([...reached].sort()).toEqual([...declared].sort());
  });
});
