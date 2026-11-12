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
import { insertLoanRequest } from "@/data/loans";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import { addDays, communityToday } from "@/lib/dates/dates";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
import { REQUEST_AHEAD_DAYS } from "@/lib/loans/limits";
import { LOAN_MESSAGE_MAX } from "@/lib/schemas/loans";
import { t } from "@/lib/text/interpolate";
import { requestForm } from "@/strings/requestForm";
import type { RequestLoanState } from "@/types/loan";
import { requestLoan } from "./loans";

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
  return { ...actual, insertLoanRequest: vi.fn(actual.insertLoanRequest) };
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
