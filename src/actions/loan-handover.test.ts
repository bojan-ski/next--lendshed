import { isRedirectError } from "next/dist/client/components/redirect-error";
import { refresh, updateTag } from "next/cache";
import { mockNextRequest, readCookie } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import { fromDbDate } from "@/data/db-dates";
import { handOverLoan, markLoanBack } from "@/data/loans";
import { db } from "@/db";
import type { LoanStatus } from "@/generated/prisma/enums";
import { addDays, communityToday } from "@/lib/dates/dates";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
import { loanActions } from "@/strings/loanActions";
import type { HandOverState, MarkReturnedState } from "@/types/loan";
import { markLoanOut, markLoanReturned } from "./loans";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/loans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/loans")>();
  return {
    ...actual,
    handOverLoan: vi.fn(actual.handOverLoan),
    markLoanBack: vi.fn(actual.markLoanBack),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const idle: HandOverState = {};
const unreturned: MarkReturnedState = {};
let borrowerId: string;

beforeAll(async () => {
  await assertMigrated();
  borrowerId = (await scope.createTestUser({ name: "Sara L." })).id;
});
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected a redirect");
    },
    (thrown: unknown) => thrown,
  );
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

// Signs a fresh user in and makes them the request's viewer.
async function actAs() {
  const user = await scope.createTestUser({ name: "Olga M." });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

// Dates relative to the real community date, so the today checks pass.
const day = (offset: number) => addDays(communityToday(), offset);

const loanRow = (id: string) => db.loan.findUniqueOrThrow({ where: { id } });

// The signed-in owner's item with one loan borrowed by `borrowerId`.
async function ownLoan(status: LoanStatus, startDate: string, endDate: string) {
  const owner = await actAs();
  const itemId = (await scope.createItem({ ownerId: owner.id })).id;
  const { id } = await scope.createLoan({
    itemId,
    borrowerId,
    status,
    startDate,
    endDate,
  });
  return { owner, itemId, id };
}

const approvedToday = () => ownLoan("approved", day(0), day(2));
const outSinceYesterday = () => ownLoan("out", day(-1), day(2));

describe("handover and return — guard and shape", () => {
  test.each([
    ["markLoanOut", () => markLoanOut(idle, form({ id: "x" }))],
    ["markLoanReturned", () => markLoanReturned(unreturned, form({ id: "x" }))],
  ] as const)("%s signed out → /login", async (_, call) => {
    mockNextRequest({ ip: scope.ip() });
    expect(await redirectTarget(call())).toMatch(/^\/login/);
  });

  test("a signed-out handover writes nothing", async () => {
    const { id } = await approvedToday();
    mockNextRequest({ ip: scope.ip() });
    await redirectTarget(markLoanOut(idle, form({ id })));
    expect((await loanRow(id)).status).toBe("approved");
  });

  test("a missing or empty id → stale for both", async () => {
    await actAs();
    for (const id of [undefined, ""]) {
      const fields: Record<string, string> = id === undefined ? {} : { id };
      expect(await markLoanOut(idle, form(fields))).toEqual({
        formError: "stale",
      });
      expect(
        await markLoanReturned(
          unreturned,
          form({ ...fields, returnedOn: day(0), asLent: "yes" }),
        ),
      ).toEqual({ formError: "stale" });
    }
    expect(refresh).not.toHaveBeenCalled();
  });

  test("server-controlled fields in the form are ignored", async () => {
    const { id } = await outSinceYesterday();
    await markLoanReturned(
      unreturned,
      form({
        id,
        returnedOn: day(0),
        asLent: "no",
        status: "cancelled",
        endedBy: "organizer",
        closedById: borrowerId,
        ownerSeenAt: "2020-01-01T00:00:00Z",
        borrowerId: "someone-else",
      }),
    );
    const row = await loanRow(id);
    expect(row).toMatchObject({
      status: "returned",
      returnedAsLent: "no",
      endedBy: null,
      closedById: null,
      borrowerId,
    });
    expect(row.ownerSeenAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe("markLoanOut", () => {
  test("the owner → out, refresh once, the flash returned, no tag, no cookie", async () => {
    const { id } = await approvedToday();

    expect(await markLoanOut(idle, form({ id, status: "returned" }))).toEqual({
      flash: "loanHandedOver",
    });
    expect((await loanRow(id)).status).toBe("out");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updateTag).not.toHaveBeenCalled();
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });

  test("the borrower → stale, no refresh, nothing written", async () => {
    const owner = await actAs();
    const itemId = (await scope.createItem({ ownerId: owner.id })).id;
    const borrower = await actAs();
    const { id } = await scope.createLoan({
      itemId,
      borrowerId: borrower.id,
      status: "approved",
      startDate: day(0),
      endDate: day(1),
    });

    expect(await markLoanOut(idle, form({ id }))).toEqual({
      formError: "stale",
    });
    expect((await loanRow(id)).status).toBe("approved");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("another loan on the item still out → stillOut, no refresh, nothing written", async () => {
    const held = await ownLoan("out", day(-5), day(-2));
    const { id } = await scope.createLoan({
      itemId: held.itemId,
      borrowerId,
      status: "approved",
      startDate: day(0),
      endDate: day(1),
    });

    expect(await markLoanOut(idle, form({ id }))).toEqual({
      formError: "stillOut",
    });
    expect((await loanRow(id)).status).toBe("approved");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a data failure → reported, unexpected, nothing written", async () => {
    const { id } = await approvedToday();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(handOverLoan).mockRejectedValueOnce(new Error("boom"));

    expect(await markLoanOut(idle, form({ id }))).toEqual({
      formError: "unexpected",
    });
    expect(report).toHaveBeenCalledWith(
      "markLoanOut: unexpected",
      expect.objectContaining({ name: "Error", message: "boom" }),
    );
    expect((await loanRow(id)).status).toBe("approved");
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("markLoanReturned", () => {
  test.each(["out", "overdue"] as const)(
    "the owner on an %s loan → returned as submitted, refresh once, the flash returned",
    async (kind) => {
      const { id } =
        kind === "out"
          ? await outSinceYesterday()
          : await ownLoan("out", day(-5), day(-2));

      expect(
        await markLoanReturned(
          unreturned,
          form({ id, returnedOn: day(0), asLent: "yes" }),
        ),
      ).toEqual({ flash: "loanReturned" });
      const row = await loanRow(id);
      expect(row).toMatchObject({
        status: "returned",
        returnedAsLent: "yes",
        endedBy: null,
      });
      expect(fromDbDate(row.returnedOn)).toBe(day(0));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(updateTag).not.toHaveBeenCalled();
      expect(readCookie(FLASH_COOKIE)).toBeUndefined();
    },
  );

  test("back on the start date is accepted", async () => {
    const { id } = await outSinceYesterday();
    expect(
      await markLoanReturned(
        unreturned,
        form({ id, returnedOn: day(-1), asLent: "no" }),
      ),
    ).toEqual({ flash: "loanReturned" });
    expect(fromDbDate((await loanRow(id)).returnedOn)).toBe(day(-1));
  });

  test.each<[string, Record<string, string>, MarkReturnedState["fieldErrors"]]>(
    [
      [
        "tomorrow",
        { returnedOn: day(1), asLent: "yes" },
        { returnedOn: [loanActions.returnedOnAfterToday] },
      ],
      [
        "the day before the start",
        { returnedOn: day(-2), asLent: "yes" },
        { returnedOn: [loanActions.returnedOnBeforeStart] },
      ],
      [
        "a malformed date",
        { returnedOn: "2030-02-30", asLent: "yes" },
        { returnedOn: [loanActions.returnedOnInvalid] },
      ],
      [
        "an empty date",
        { returnedOn: "", asLent: "yes" },
        { returnedOn: [loanActions.returnedOnInvalid] },
      ],
      [
        "no answer",
        { returnedOn: day(0) },
        { asLent: [loanActions.asLentRequired] },
      ],
      [
        "unknown as the answer",
        { returnedOn: day(0), asLent: "unknown" },
        { asLent: [loanActions.asLentRequired] },
      ],
      [
        "a bad date and no answer",
        { returnedOn: "soon" },
        {
          returnedOn: [loanActions.returnedOnInvalid],
          asLent: [loanActions.asLentRequired],
        },
      ],
    ],
  )(
    "%s → field errors, values echoed, nothing written",
    async (_, fields, fieldErrors) => {
      const { id } = await outSinceYesterday();

      expect(
        await markLoanReturned(unreturned, form({ id, ...fields })),
      ).toEqual({
        fieldErrors,
        values: { returnedOn: fields.returnedOn, asLent: fields.asLent ?? "" },
      });
      expect((await loanRow(id)).status).toBe("out");
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("an approved loan, or the borrower → stale, nothing written", async () => {
    const approved = await approvedToday();
    expect(
      await markLoanReturned(
        unreturned,
        form({ id: approved.id, returnedOn: day(0), asLent: "yes" }),
      ),
    ).toEqual({ formError: "stale" });

    const owner = await actAs();
    const itemId = (await scope.createItem({ ownerId: owner.id })).id;
    const borrower = await actAs();
    const { id } = await scope.createLoan({
      itemId,
      borrowerId: borrower.id,
      status: "out",
      startDate: day(-1),
      endDate: day(1),
    });
    expect(
      await markLoanReturned(
        unreturned,
        form({ id, returnedOn: day(0), asLent: "yes" }),
      ),
    ).toEqual({ formError: "stale" });
    expect((await loanRow(id)).status).toBe("out");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a data failure → reported, unexpected with the values, nothing written", async () => {
    const { id } = await outSinceYesterday();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(markLoanBack).mockRejectedValueOnce(new Error("boom"));

    expect(
      await markLoanReturned(
        unreturned,
        form({ id, returnedOn: day(0), asLent: "no" }),
      ),
    ).toEqual({
      formError: "unexpected",
      values: { returnedOn: day(0), asLent: "no" },
    });
    expect(report).toHaveBeenCalledWith(
      "markLoanReturned: unexpected",
      expect.objectContaining({ name: "Error", message: "boom" }),
    );
    expect((await loanRow(id)).status).toBe("out");
    expect(refresh).not.toHaveBeenCalled();
  });
});

// 00:30 in Belgrade on 15 June 2030 is 22:30Z on the 14th: both actions judge
// the loan by the community date whatever the process zone.
describe.each(TEST_ZONES)("handover and return — today in %s", (zone) => {
  useProcessTimeZone(zone);
  const NOW = new Date("2030-06-14T22:30:00Z");
  const TODAY = "2030-06-15";
  const YESTERDAY = "2030-06-14";

  async function ownAtNight(
    status: LoanStatus,
    startDate: string,
    endDate: string,
  ) {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    return ownLoan(status, startDate, endDate);
  }
  afterEach(() => vi.useRealTimers());

  test.each([
    [
      "an approved loan starting today",
      TODAY,
      "2030-06-16",
      { flash: "loanHandedOver" },
    ],
    [
      "an approval that ended yesterday",
      "2030-06-12",
      YESTERDAY,
      { formError: "stale" },
    ],
  ])("%s → %j", async (_, startDate, endDate, expected) => {
    const { id } = await ownAtNight("approved", startDate, endDate);
    expect(await markLoanOut(idle, form({ id }))).toEqual(expected);
  });

  test("back on the community date is accepted; the day after is a field error", async () => {
    const late = await ownAtNight("out", "2030-06-12", "2030-06-20");
    expect(
      await markLoanReturned(
        unreturned,
        form({ id: late.id, returnedOn: "2030-06-16", asLent: "yes" }),
      ),
    ).toMatchObject({
      fieldErrors: { returnedOn: [loanActions.returnedOnAfterToday] },
    });

    expect(
      await markLoanReturned(
        unreturned,
        form({ id: late.id, returnedOn: TODAY, asLent: "yes" }),
      ),
    ).toEqual({ flash: "loanReturned" });
  });
});
