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
import {
  approveLoanRequest,
  cancelLoanByParty,
  closeLoanByOrganizer,
  declineLoanRequest,
  insertLoanRequest,
} from "@/data/loans";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import { addDays, communityToday } from "@/lib/dates/dates";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
import { REQUEST_AHEAD_DAYS } from "@/lib/loans/limits";
import { LOAN_MESSAGE_MAX, LOAN_REASON_MAX } from "@/lib/schemas/loans";
import { t } from "@/lib/text/interpolate";
import { loanActions } from "@/strings/loanActions";
import { requestForm } from "@/strings/requestForm";
import type {
  LoanDecisionState,
  OrganizerCloseState,
  RequestLoanState,
} from "@/types/loan";
import {
  approveLoan,
  cancelLoan,
  closeLoanAsOrganizer,
  declineLoan,
  requestLoan,
} from "./loans";

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
    insertLoanRequest: vi.fn(actual.insertLoanRequest),
    approveLoanRequest: vi.fn(actual.approveLoanRequest),
    declineLoanRequest: vi.fn(actual.declineLoanRequest),
    cancelLoanByParty: vi.fn(actual.cancelLoanByParty),
    closeLoanByOrganizer: vi.fn(actual.closeLoanByOrganizer),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const idle: RequestLoanState = {};
let ownerId: string;
// Borrows on the blocking rows the overlap cases set up.
let otherId: string;

beforeAll(async () => {
  await assertMigrated();
  [ownerId, otherId] = await Promise.all(
    ["Olga M.", "Sara L."].map(
      async (name) => (await scope.createTestUser({ name })).id,
    ),
  );
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
async function actAs(contactDetails: string | null = "Call 555") {
  const user = await scope.createTestUser({ name: "Ana P.", contactDetails });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

async function item({
  owner = ownerId,
  status = "listed",
  maxLoanDays = 7,
}: { owner?: string; status?: ItemStatus; maxLoanDays?: number } = {}) {
  return (await scope.createItem({ ownerId: owner, status, maxLoanDays })).id;
}

const loanOn = (
  itemId: string,
  borrowerId: string,
  status: LoanStatus,
  startDate: string,
  endDate: string,
) => scope.createLoan({ itemId, borrowerId, status, startDate, endDate });

// Dates relative to the real community date, so the window check passes.
const day = (offset: number) => addDays(communityToday(), offset);

function fields(itemId: string, overrides: Record<string, string> = {}) {
  return {
    itemId,
    startDate: day(2),
    endDate: day(3),
    message: "",
    ...overrides,
  };
}

const values = (all: Record<string, string>) => ({
  startDate: all.startDate,
  endDate: all.endDate,
  message: all.message,
});

const ownRequests = (borrowerId: string) =>
  db.loan.findMany({ where: { borrowerId } });

async function created(promise: Promise<unknown>) {
  const target = await redirectTarget(promise);
  expect(target).toMatch(/^\/loans\/[0-9a-f-]{36}$/);
  return target.split("/")[2];
}

describe("requestLoan — guard and shape", () => {
  test("signed out → /login before any parse or write", async () => {
    mockNextRequest({ ip: scope.ip() });
    const target = await redirectTarget(
      requestLoan(idle, form(fields(crypto.randomUUID()))),
    );
    expect(target).toBe("/login");
    expect(insertLoanRequest).not.toHaveBeenCalled();
  });

  test.each([
    ["a non-ISO start", { startDate: "2030-13-01" }, ["startDate"]],
    ["a non-ISO end", { endDate: "soon" }, ["endDate"]],
    [
      "an end before the start",
      { startDate: day(3), endDate: day(2) },
      ["endDate"],
    ],
    [
      "a 501-character message",
      { message: "x".repeat(LOAN_MESSAGE_MAX + 1) },
      ["message"],
    ],
  ] as const)(
    "%s → exactly that field, values echoed",
    async (_label, change, keys) => {
      await actAs();
      const all = fields(crypto.randomUUID(), change);

      const state = await requestLoan(idle, form(all));

      expect(Object.keys(state.fieldErrors ?? {})).toEqual(keys);
      expect(state.values).toEqual(values(all));
      expect(insertLoanRequest).not.toHaveBeenCalled();
      expect(readCookie(FLASH_COOKIE)).toBeUndefined();
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("an end before the start reads the schema's message", async () => {
    await actAs();
    const state = await requestLoan(
      idle,
      form(fields(crypto.randomUUID(), { startDate: day(3), endDate: day(2) })),
    );
    expect(state.fieldErrors?.endDate).toEqual([requestForm.endBeforeStart]);
  });

  test("a 500-character message is kept; a whitespace-only one is stored as null", async () => {
    const viewer = await actAs();
    const long = "x".repeat(LOAN_MESSAGE_MAX);
    const first = await created(
      requestLoan(idle, form(fields(await item(), { message: long }))),
    );
    const second = await created(
      requestLoan(idle, form(fields(await item(), { message: "  \n  " }))),
    );

    const rows = await ownRequests(viewer.id);
    expect(rows.find(({ id }) => id === first)?.requestMessage).toBe(long);
    expect(rows.find(({ id }) => id === second)?.requestMessage).toBeNull();
  });
});

describe("requestLoan — the date window", () => {
  test.each([
    ["today", 0],
    ["today + 60", REQUEST_AHEAD_DAYS],
  ])("a start of %s is accepted", async (_label, offset) => {
    await actAs();
    await created(
      requestLoan(
        idle,
        form(
          fields(await item(), {
            startDate: day(offset),
            endDate: day(offset),
          }),
        ),
      ),
    );
  });

  test.each([
    ["yesterday", -1],
    ["today + 61", REQUEST_AHEAD_DAYS + 1],
  ])(
    "a start of %s → startDate, no transaction opened",
    async (_label, offset) => {
      await actAs();
      const all = fields(await item(), {
        startDate: day(offset),
        endDate: day(offset + 1),
      });

      expect(await requestLoan(idle, form(all))).toEqual({
        fieldErrors: {
          startDate: [
            t(requestForm.startOutOfWindow, { days: REQUEST_AHEAD_DAYS }),
          ],
        },
        values: values(all),
      });
      expect(insertLoanRequest).not.toHaveBeenCalled();
    },
  );
});

describe("requestLoan — length", () => {
  test("exactly the item's maximum is accepted; one more → endDate naming it", async () => {
    await actAs();
    const id = await item({ maxLoanDays: 4 });
    const tooLong = fields(id, { startDate: day(1), endDate: day(5) });

    expect(await requestLoan(idle, form(tooLong))).toEqual({
      fieldErrors: { endDate: [t(requestForm.tooLong, { max: 4 })] },
      values: values(tooLong),
    });
    await created(
      requestLoan(
        idle,
        form(fields(id, { startDate: day(1), endDate: day(4) })),
      ),
    );
  });

  test("a one-day loan (start = end) is accepted", async () => {
    const viewer = await actAs();
    await created(
      requestLoan(
        idle,
        form(
          fields(await item({ maxLoanDays: 1 }), {
            startDate: day(1),
            endDate: day(1),
          }),
        ),
      ),
    );
    const [row] = await ownRequests(viewer.id);
    expect(fromDbDate(row.startDate)).toBe(fromDbDate(row.endDate));
  });
});

describe("requestLoan — refusals", () => {
  test.each([
    ["an empty itemId", async () => ""],
    ["a malformed itemId", async () => "not-an-item"],
    ["an unknown item", async () => crypto.randomUUID()],
    ["a hidden item", () => item({ status: "hidden" })],
    ["a retired item", () => item({ status: "retired" })],
    [
      "a suspended owner's listed item",
      async () =>
        item({
          owner: (await scope.createTestUser({ status: "suspended" })).id,
        }),
    ],
  ])("%s → stale, values echoed, nothing written", async (_label, makeItem) => {
    const viewer = await actAs();
    const all = fields(await makeItem());

    expect(await requestLoan(idle, form(all))).toEqual({
      formError: "stale",
      values: values(all),
    });
    expect(await ownRequests(viewer.id)).toEqual([]);
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
    expect(refresh).not.toHaveBeenCalled();
  });

  test("the viewer's own item → stale", async () => {
    const viewer = await actAs();
    const all = fields(await item({ owner: viewer.id }));
    expect((await requestLoan(idle, form(all))).formError).toBe("stale");
  });

  // getViewer refuses a suspended session, so only the transaction's own
  // re-check can see this row: called directly.
  test("a suspended actor row → stale in the transaction", async () => {
    const suspended = await scope.createTestUser({
      status: "suspended",
      contactDetails: "Call 555",
    });
    const outcome = await insertLoanRequest(
      suspended.id,
      {
        itemId: await item(),
        startDate: day(1),
        endDate: day(2),
        message: null,
      },
      communityToday(),
    );
    expect(outcome).toEqual({ kind: "stale" });
  });

  test("no contact details → needsContactDetails", async () => {
    const viewer = await actAs(null);
    const all = fields(await item());
    expect(await requestLoan(idle, form(all))).toEqual({
      formError: "needsContactDetails",
      values: values(all),
    });
    expect(await ownRequests(viewer.id)).toEqual([]);
  });
});

describe("requestLoan — limits", () => {
  test("an open request on the item → itemLimit; an expired one doesn't count", async () => {
    const viewer = await actAs();
    const open = await item();
    const expired = await item();
    await loanOn(open, viewer.id, "requested", day(5), day(6));
    await loanOn(expired, viewer.id, "requested", day(-2), day(-1));

    expect((await requestLoan(idle, form(fields(open)))).formError).toBe(
      "itemLimit",
    );
    await created(requestLoan(idle, form(fields(expired))));
  });

  test("five open elsewhere → overallLimit; four → created", async () => {
    const viewer = await actAs();
    for (let n = 0; n < 4; n++) {
      await loanOn(await item(), viewer.id, "requested", day(5), day(6));
    }
    await created(requestLoan(idle, form(fields(await item()))));
    expect(
      (await requestLoan(idle, form(fields(await item())))).formError,
    ).toBe("overallLimit");
  });

  test("an expired request among five doesn't count", async () => {
    const viewer = await actAs();
    for (let n = 0; n < 4; n++) {
      await loanOn(await item(), viewer.id, "requested", day(5), day(6));
    }
    await loanOn(await item(), viewer.id, "requested", day(-3), day(-2));
    await created(requestLoan(idle, form(fields(await item()))));
  });

  test("an approved loan by the viewer on the item doesn't block other dates", async () => {
    const viewer = await actAs();
    const id = await item();
    await loanOn(id, viewer.id, "approved", day(10), day(12));
    await created(requestLoan(idle, form(fields(id))));
  });
});

describe("requestLoan — overlap", () => {
  // The request is day(5)..day(7); each blocking row gets its own item.
  const request = (id: string) =>
    requestLoan(idle, form(fields(id, { startDate: day(5), endDate: day(7) })));

  test.each([
    ["approved", day(3), day(5)],
    ["approved", day(7), day(9)],
    ["out", day(0), day(5)],
    ["out", day(7), day(8)],
  ] as const)(
    "%s from %s to %s overlaps by a day → datesTaken",
    async (status, startDate, endDate) => {
      const viewer = await actAs();
      const id = await item();
      await loanOn(id, otherId, status, startDate, endDate);

      expect((await request(id)).formError).toBe("datesTaken");
      expect(await ownRequests(viewer.id)).toEqual([]);
    },
  );

  test("an approved range ending the day before is adjacent → created", async () => {
    await actAs();
    const id = await item();
    await loanOn(id, otherId, "approved", day(2), day(4));
    await created(request(id));
  });

  test.each([
    ["requested", day(5), day(7)],
    ["declined", day(5), day(7)],
    ["cancelled", day(5), day(7)],
    ["returned", day(5), day(7)],
    ["expired", day(5), day(7)],
    ["lapsed", day(5), day(7)],
  ] as const)(
    "an overlapping %s loan never blocks",
    async (status, startDate, endDate) => {
      await actAs();
      const id = await item();
      await loanOn(id, otherId, status, startDate, endDate);
      await created(request(id));
    },
  );

  test("an overdue out loan never blocks a request", async () => {
    await actAs();
    const id = await item();
    await loanOn(id, otherId, "out", day(-5), day(-2));
    await created(request(id));
  });
});

describe("requestLoan — success", () => {
  test("writes a requested row with server fields, flashes and opens the loan", async () => {
    const viewer = await actAs();
    const id = await item();
    const before = Date.now();

    const loanId = await created(
      requestLoan(
        idle,
        form({
          ...fields(id, { message: "  Saturday morning?  " }),
          borrowerId: ownerId,
          status: "approved",
          ownerSeenAt: "2030-01-01T00:00:00Z",
          changedAt: "2020-01-01T00:00:00Z",
        }),
      ),
    );

    const row = await db.loan.findUniqueOrThrow({ where: { id: loanId } });
    expect(row).toMatchObject({
      itemId: id,
      borrowerId: viewer.id,
      status: "requested",
      requestMessage: "Saturday morning?",
      ownerSeenAt: null,
      endedBy: null,
      systemReason: null,
    });
    expect(fromDbDate(row.startDate)).toBe(day(2));
    expect(fromDbDate(row.endDate)).toBe(day(3));
    expect(row.borrowerSeenAt?.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row.changedAt.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(readCookie(FLASH_COOKIE)).toBe("requestSent");
    expect(refresh).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
  });

  test("a data failure → reported, unexpected with the values echoed, nothing written", async () => {
    const viewer = await actAs();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(insertLoanRequest).mockRejectedValueOnce(new Error("boom"));
    const all = fields(await item());

    expect(await requestLoan(idle, form(all))).toEqual({
      formError: "unexpected",
      values: values(all),
    });
    expect(report).toHaveBeenCalledWith(
      "requestLoan: unexpected",
      expect.objectContaining({ name: "Error", message: "boom" }),
    );
    expect(await ownRequests(viewer.id)).toEqual([]);
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });
});

// 00:30 in Belgrade on 15 June 2030 is 22:30Z on the 14th: the window counts
// from the community date whatever the process zone.
describe.each(TEST_ZONES)("requestLoan — window in %s", (zone) => {
  useProcessTimeZone(zone);
  const NOW = new Date("2030-06-14T22:30:00Z");
  const TODAY = "2030-06-15";

  // The clock is fixed before sign-in, so the session is valid "now".
  async function actAtNight() {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    return actAs();
  }
  afterEach(() => vi.useRealTimers());

  test.each([
    [TODAY, true],
    [addDays(TODAY, -1), false],
    [addDays(TODAY, REQUEST_AHEAD_DAYS), true],
    [addDays(TODAY, REQUEST_AHEAD_DAYS + 1), false],
  ])("a start of %s → accepted: %s", async (startDate, accepted) => {
    await actAtNight();
    const request = requestLoan(
      idle,
      form(fields(await item(), { startDate, endDate: startDate })),
    );
    if (accepted) await created(request);
    else
      expect(Object.keys((await request).fieldErrors ?? {})).toEqual([
        "startDate",
      ]);
  });
});

const undecided: LoanDecisionState = {};
const DECISIONS = [
  ["approveLoan", approveLoan],
  ["declineLoan", declineLoan],
  ["cancelLoan", cancelLoan],
] as const;

// The signed-in owner of a fresh item with one loan on it borrowed by `otherId`.
async function ownRequest(status: LoanStatus = "requested") {
  const owner = await actAs();
  const itemId = await item({ owner: owner.id });
  const { id } = await loanOn(itemId, otherId, status, day(2), day(3));
  return { owner, itemId, id };
}

// The signed-in borrower of a loan on an item `ownerId` owns.
async function myRequest(status: LoanStatus = "requested") {
  const borrower = await actAs();
  const { id } = await loanOn(
    await item(),
    borrower.id,
    status,
    day(2),
    day(3),
  );
  return { borrower, id };
}

const loanRow = (id: string) => db.loan.findUniqueOrThrow({ where: { id } });

describe("loan decisions — guard and shape", () => {
  test.each(DECISIONS)(
    "%s signed out → /login before any parse or write",
    async (_, action) => {
      const { id } = await loanOn(
        await item(),
        otherId,
        "requested",
        day(2),
        day(3),
      );
      mockNextRequest({ ip: scope.ip() });

      expect(
        await redirectTarget(action(undecided, form({ id, stage: "request" }))),
      ).toMatch(/^\/login/);
      expect((await loanRow(id)).status).toBe("requested");
    },
  );

  test.each(DECISIONS)(
    "%s with a missing or empty id → stale, no field error",
    async (_, action) => {
      await actAs();
      expect(await action(undecided, form({ stage: "request" }))).toEqual({
        formError: "stale",
      });
      expect(
        await action(undecided, form({ id: "", stage: "request" })),
      ).toEqual({ formError: "stale" });
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("cancelLoan with a missing or unknown stage → stale, nothing written", async () => {
    const { id } = await myRequest();
    expect(await cancelLoan(undecided, form({ id }))).toEqual({
      formError: "stale",
    });
    expect(await cancelLoan(undecided, form({ id, stage: "out" }))).toEqual({
      formError: "stale",
    });
    expect((await loanRow(id)).status).toBe("requested");
  });

  test("a 301-character reason → fieldErrors.reason, echoed, nothing written; 300 is accepted", async () => {
    const { id } = await ownRequest();
    const tooLong = "x".repeat(LOAN_REASON_MAX + 1);

    expect(await declineLoan(undecided, form({ id, reason: tooLong }))).toEqual(
      {
        fieldErrors: {
          reason: [t(loanActions.reasonTooLong, { max: LOAN_REASON_MAX })],
        },
        values: { reason: tooLong },
      },
    );
    expect((await loanRow(id)).status).toBe("requested");

    const exact = "y".repeat(LOAN_REASON_MAX);
    expect(await declineLoan(undecided, form({ id, reason: exact }))).toEqual({
      flash: "loanDeclined",
    });
    expect((await loanRow(id)).statusReason).toBe(exact);
  });

  test("the reason is trimmed; whitespace-only is stored as null", async () => {
    const first = await ownRequest();
    await declineLoan(undecided, form({ id: first.id, reason: "  Away  " }));
    expect((await loanRow(first.id)).statusReason).toBe("Away");

    const second = await myRequest();
    await cancelLoan(
      undecided,
      form({ id: second.id, stage: "request", reason: " \r\n " }),
    );
    expect((await loanRow(second.id)).statusReason).toBeNull();
  });

  test("server-controlled fields in the form are ignored", async () => {
    const { id } = await ownRequest();
    await declineLoan(
      undecided,
      form({
        id,
        status: "approved",
        endedBy: "system",
        ownerSeenAt: "2020-01-01T00:00:00Z",
        borrowerId: ownerId,
      }),
    );
    const row = await loanRow(id);
    expect(row).toMatchObject({
      status: "declined",
      endedBy: "owner",
      borrowerId: otherId,
    });
    expect(row.ownerSeenAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe("loan decisions — success", () => {
  test("approveLoan → approved, refresh once, the flash returned, no tag, no cookie", async () => {
    const { id } = await ownRequest();

    expect(await approveLoan(undecided, form({ id }))).toEqual({
      flash: "loanApproved",
    });
    expect((await loanRow(id)).status).toBe("approved");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updateTag).not.toHaveBeenCalled();
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });

  test("declineLoan → declined by the owner, refresh once, the flash returned", async () => {
    const { id } = await ownRequest();

    expect(await declineLoan(undecided, form({ id, reason: "Away" }))).toEqual({
      flash: "loanDeclined",
    });
    expect(await loanRow(id)).toMatchObject({
      status: "declined",
      endedBy: "owner",
      statusReason: "Away",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updateTag).not.toHaveBeenCalled();
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });

  test.each([
    ["a request", "requested", "request"],
    ["an approved loan", "approved", "loan"],
  ] as const)(
    "cancelLoan by the borrower on %s → cancelled by the borrower",
    async (_, status, stage) => {
      const { id } = await myRequest(status);

      expect(await cancelLoan(undecided, form({ id, stage }))).toEqual({
        flash: "loanCancelled",
      });
      expect(await loanRow(id)).toMatchObject({
        status: "cancelled",
        endedBy: "borrower",
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(updateTag).not.toHaveBeenCalled();
    },
  );

  test("cancelLoan by the owner on an approved loan → cancelled by the owner", async () => {
    const { id } = await ownRequest("approved");
    expect(await cancelLoan(undecided, form({ id, stage: "loan" }))).toEqual({
      flash: "loanCancelled",
    });
    expect((await loanRow(id)).endedBy).toBe("owner");
  });
});

describe("loan decisions — refusals", () => {
  test("approve by the borrower → stale, no refresh, nothing written", async () => {
    const { id } = await myRequest();
    expect(await approveLoan(undecided, form({ id }))).toEqual({
      formError: "stale",
    });
    expect((await loanRow(id)).status).toBe("requested");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("approve into a fixture approved loan → datesTaken, no refresh", async () => {
    const { itemId, id } = await ownRequest();
    await loanOn(itemId, ownerId, "approved", day(2), day(3));

    expect(await approveLoan(undecided, form({ id }))).toEqual({
      formError: "datesTaken",
    });
    expect((await loanRow(id)).status).toBe("requested");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("the owner cancelling a request, or declining an approved loan → stale", async () => {
    const request = await ownRequest();
    expect(
      await cancelLoan(undecided, form({ id: request.id, stage: "request" })),
    ).toEqual({ formError: "stale" });

    const approved = await ownRequest("approved");
    expect(await declineLoan(undecided, form({ id: approved.id }))).toEqual({
      formError: "stale",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test.each([
    ["approveLoan", approveLoan, approveLoanRequest],
    ["declineLoan", declineLoan, declineLoanRequest],
    ["cancelLoan", cancelLoan, cancelLoanByParty],
  ] as const)(
    "%s: a data failure → reported, unexpected, nothing written",
    async (name, action, data) => {
      const { id } = await ownRequest("approved");
      const report = vi.spyOn(console, "error").mockImplementation(() => {});
      vi.mocked(data).mockRejectedValueOnce(new Error("boom"));

      const state = await action(
        undecided,
        form({ id, stage: "loan", reason: "Typed" }),
      );

      expect(state.formError).toBe("unexpected");
      if (name !== "approveLoan") {
        expect(state.values).toEqual({ reason: "Typed" });
      }
      expect(report).toHaveBeenCalledWith(
        `${name}: unexpected`,
        expect.objectContaining({ name: "Error", message: "boom" }),
      );
      expect((await loanRow(id)).status).toBe("approved");
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});

// --- closeLoanAsOrganizer (spec 19) -------------------------------------------

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const unclosed: OrganizerCloseState = {};

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

// Signs a fresh organizer in and makes them the request's viewer.
async function actAsOrganizer() {
  const user = await scope.createTestUser({
    name: "Iva O.",
    role: "organizer",
  });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

// `ownerId`'s item, borrowed by `otherId`, out since yesterday (or overdue).
async function outLoan(overdue = false) {
  const itemId = await item();
  return overdue
    ? loanOn(itemId, otherId, "out", day(-5), day(-2))
    : loanOn(itemId, otherId, "out", day(-1), day(2));
}

const closeFields = (id: string, overrides: Record<string, string> = {}) => ({
  id,
  returnedOn: day(0),
  asLent: "yes",
  note: "The owner is away; Sara brought it to me.",
  ...overrides,
});

describe("closeLoanAsOrganizer — guard and shape", () => {
  test("signed out → /login, nothing written", async () => {
    const { id } = await outLoan();
    mockNextRequest({ ip: scope.ip() });

    expect(
      await redirectTarget(
        closeLoanAsOrganizer(unclosed, form(closeFields(id))),
      ),
    ).toMatch(/^\/login/);
    expect((await loanRow(id)).status).toBe("out");
    expect(closeLoanByOrganizer).not.toHaveBeenCalled();
  });

  test("a member gets not-found, nothing written", async () => {
    const { id } = await outLoan();
    await actAs();

    const error = await thrownBy(
      closeLoanAsOrganizer(unclosed, form(closeFields(id))),
    );
    expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
    expect((await loanRow(id)).status).toBe("out");
    expect(closeLoanByOrganizer).not.toHaveBeenCalled();
  });

  test("a missing or empty id → stale, no field error", async () => {
    await actAsOrganizer();
    const withoutId = { returnedOn: day(0), asLent: "yes", note: "Closed" };
    expect(await closeLoanAsOrganizer(unclosed, form(withoutId))).toEqual({
      formError: "stale",
    });
    expect(await closeLoanAsOrganizer(unclosed, form(closeFields("")))).toEqual(
      { formError: "stale" },
    );
    expect(refresh).not.toHaveBeenCalled();
  });

  const tooLong = "x".repeat(150) + "\r\n" + "x".repeat(150);
  test.each<
    [string, Record<string, string>, OrganizerCloseState["fieldErrors"]]
  >([
    [
      "tomorrow",
      { returnedOn: day(1) },
      { returnedOn: [loanActions.returnedOnAfterToday] },
    ],
    [
      "the day before the start",
      { returnedOn: day(-2) },
      { returnedOn: [loanActions.returnedOnBeforeStart] },
    ],
    [
      "a malformed date",
      { returnedOn: "2030-02-30" },
      { returnedOn: [loanActions.returnedOnInvalid] },
    ],
    [
      "an answer outside the three",
      { asLent: "maybe" },
      { asLent: [loanActions.asLentRequiredClose] },
    ],
    ["an empty note", { note: "" }, { note: [loanActions.noteRequired] }],
    [
      "a whitespace-only note",
      { note: " \r\n  " },
      { note: [loanActions.noteRequired] },
    ],
    [
      "a 301-character note once CRLF is one character",
      { note: tooLong },
      {
        note: [t(loanActions.noteTooLong, { max: LOAN_REASON_MAX })],
      },
    ],
  ])(
    "%s → field errors, values echoed, nothing written",
    async (_, overrides, fieldErrors) => {
      const { id } = await outLoan();
      await actAsOrganizer();
      const fields = closeFields(id, overrides);

      expect(await closeLoanAsOrganizer(unclosed, form(fields))).toEqual({
        fieldErrors,
        values: {
          returnedOn: fields.returnedOn,
          asLent: fields.asLent,
          note: fields.note,
        },
      });
      expect((await loanRow(id)).status).toBe("out");
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("no answer and no note → both field errors, echoed as empty", async () => {
    const { id } = await outLoan();
    await actAsOrganizer();

    expect(
      await closeLoanAsOrganizer(unclosed, form({ id, returnedOn: day(0) })),
    ).toEqual({
      fieldErrors: {
        asLent: [loanActions.asLentRequiredClose],
        note: [loanActions.noteRequired],
      },
      values: { returnedOn: day(0), asLent: "", note: "" },
    });
    expect((await loanRow(id)).status).toBe("out");
  });

  test("300 characters once CRLF is one character are accepted, stored with LF", async () => {
    const { id } = await outLoan();
    await actAsOrganizer();
    const note = "x".repeat(149) + "\r\n" + "x".repeat(150);

    expect(
      await closeLoanAsOrganizer(unclosed, form(closeFields(id, { note }))),
    ).toEqual({ flash: "loanClosed" });
    expect((await loanRow(id)).statusReason).toBe(
      "x".repeat(149) + "\n" + "x".repeat(150),
    );
  });

  test("server-controlled fields in the form are ignored", async () => {
    const { id } = await outLoan();
    const { ownerSeenAt } = await loanRow(id);
    const organizer = await actAsOrganizer();

    await closeLoanAsOrganizer(
      unclosed,
      form({
        ...closeFields(id),
        status: "cancelled",
        endedBy: "organizer",
        closedById: otherId,
        ownerSeenAt: "2020-01-01T00:00:00Z",
        borrowerId: ownerId,
      }),
    );
    expect(await loanRow(id)).toMatchObject({
      status: "returned",
      endedBy: null,
      closedById: organizer.id,
      borrowerId: otherId,
      ownerSeenAt,
    });
  });
});

describe("closeLoanAsOrganizer — success", () => {
  test.each([
    ["an out loan", false, "yes"],
    ["an overdue loan", true, "no"],
    ["an out loan, not known how it came back", false, "unknown"],
  ] as const)(
    "%s → returned with the note and the closer, refresh once, the flash returned",
    async (_, overdue, asLent) => {
      const { id } = await outLoan(overdue);
      const before = await loanRow(id);
      const organizer = await actAsOrganizer();

      expect(
        await closeLoanAsOrganizer(
          unclosed,
          form(closeFields(id, { asLent, note: "  Closed for Sara.  " })),
        ),
      ).toEqual({ flash: "loanClosed" });
      const row = await loanRow(id);
      expect(row).toMatchObject({
        status: "returned",
        returnedAsLent: asLent,
        statusReason: "Closed for Sara.",
        closedById: organizer.id,
        endedBy: null,
        systemReason: null,
        ownerSeenAt: before.ownerSeenAt,
        borrowerSeenAt: before.borrowerSeenAt,
      });
      expect(fromDbDate(row.returnedOn)).toBe(day(0));
      expect(row.changedAt.getTime()).toBeGreaterThan(
        before.changedAt.getTime(),
      );
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(updateTag).not.toHaveBeenCalled();
      expect(readCookie(FLASH_COOKIE)).toBeUndefined();
    },
  );
});

describe("closeLoanAsOrganizer — refusals", () => {
  test.each([
    "requested",
    "approved",
    "returned",
    "declined",
    "cancelled",
  ] as const)(
    "a %s loan → stale, nothing written, no refresh",
    async (status) => {
      const { id } = await loanOn(
        await item(),
        otherId,
        status,
        day(2),
        day(3),
      );
      await actAsOrganizer();

      expect(
        await closeLoanAsOrganizer(unclosed, form(closeFields(id))),
      ).toEqual({ formError: "stale" });
      expect((await loanRow(id)).status).toBe(status);
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("an organizer who owns the item, or borrowed it → stale, nothing written", async () => {
    const owner = await actAsOrganizer();
    const own = await loanOn(
      await item({ owner: owner.id }),
      otherId,
      "out",
      day(-1),
      day(2),
    );
    expect(
      await closeLoanAsOrganizer(unclosed, form(closeFields(own.id))),
    ).toEqual({ formError: "stale" });

    const borrower = await actAsOrganizer();
    const held = await loanOn(
      await item(),
      borrower.id,
      "out",
      day(-1),
      day(2),
    );
    expect(
      await closeLoanAsOrganizer(unclosed, form(closeFields(held.id))),
    ).toEqual({ formError: "stale" });

    expect((await loanRow(own.id)).status).toBe("out");
    expect((await loanRow(held.id)).status).toBe("out");
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a data failure → reported, unexpected with the values, nothing written", async () => {
    const { id } = await outLoan();
    await actAsOrganizer();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(closeLoanByOrganizer).mockRejectedValueOnce(new Error("boom"));

    expect(
      await closeLoanAsOrganizer(
        unclosed,
        form(closeFields(id, { asLent: "unknown", note: "Typed" })),
      ),
    ).toEqual({
      formError: "unexpected",
      values: { returnedOn: day(0), asLent: "unknown", note: "Typed" },
    });
    expect(report).toHaveBeenCalledWith(
      "closeLoanAsOrganizer: unexpected",
      expect.objectContaining({ name: "Error", message: "boom" }),
    );
    expect((await loanRow(id)).status).toBe("out");
    expect(refresh).not.toHaveBeenCalled();
  });
});

// 00:30 in Belgrade on 15 June 2030 is 22:30Z on the 14th: approve and cancel
// judge the loan by the community date whatever the process zone.
describe.each(TEST_ZONES)("loan decisions — today in %s", (zone) => {
  useProcessTimeZone(zone);
  const NOW = new Date("2030-06-14T22:30:00Z");
  const TODAY = "2030-06-15";
  const YESTERDAY = "2030-06-14";

  async function actAtNight() {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    return actAs();
  }
  afterEach(() => vi.useRealTimers());

  test.each([
    [TODAY, { flash: "loanApproved" }],
    [YESTERDAY, { formError: "stale" }],
  ])("a request starting %s → %j", async (startDate, expected) => {
    const owner = await actAtNight();
    const itemId = await item({ owner: owner.id });
    const { id } = await loanOn(itemId, otherId, "requested", startDate, TODAY);
    expect(await approveLoan(undecided, form({ id }))).toEqual(expected);
  });

  test("an approval that ended yesterday is lapsed: cancelling it is stale", async () => {
    const borrower = await actAtNight();
    const { id } = await loanOn(
      await item(),
      borrower.id,
      "approved",
      "2030-06-12",
      YESTERDAY,
    );
    expect(await cancelLoan(undecided, form({ id, stage: "loan" }))).toEqual({
      formError: "stale",
    });
    expect((await loanRow(id)).status).toBe("approved");
  });
});
