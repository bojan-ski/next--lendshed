import { isRedirectError } from "next/dist/client/components/redirect-error";
import { refresh } from "next/cache";
import ts from "typescript";
import { parseFile } from "@/__tests__/support/import-graph";
import { loanRow } from "@/__tests__/support/loan-fixtures";
import {
  createSession,
  memberFootprint,
  viewerOf,
} from "@/__tests__/support/member-fixtures";
import { mockNextRequest } from "@/__tests__/support/next-request";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { deleteOwnAccount } from "@/actions/account";
import { retireItemAsOrganizer } from "@/actions/items";
import { closeLoanAsOrganizer } from "@/actions/loans";
import {
  deleteMember,
  reinstateMember,
  suspendMember,
} from "@/actions/members";
import { GET } from "@/app/api/cron/daily/route";
import { DAILY_JOB_STEPS } from "@/data/daily-job";
import { getOpenInvitations } from "@/data/invitations";
import { getLoanForViewer } from "@/data/loans";
import { deleteOwnUser } from "@/data/members";
import { getMyLoans } from "@/data/my-loans";
import { getUsage } from "@/data/photos";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { auth } from "@/lib/auth/auth";
import { addDays, communityMidnight, communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { people } from "@/strings/people";
import type { ViewerDTO } from "@/types/viewer";

const SECRET = vi.hoisted(() => "stage-e-exit-cron-secret-0123456789");

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock("@/db", async (importOriginal) =>
  (await import("@/__tests__/support/snapshot")).snapshotDbModule(
    await importOriginal<typeof import("@/db")>(),
  ),
);
vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);
vi.mock("@/lib/env/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/env/server")>();
  return { ...actual, env: { ...actual.env, CRON_SECRET: SECRET } };
});
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/feedback/flash", () => ({ setFlash: vi.fn() }));
vi.mock("@/lib/feedback/report", () => ({ reportUnexpected: vi.fn() }));
vi.mock("@/lib/auth/sign-in", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/sign-in")>();
  return { ...actual, copySetCookies: vi.fn() };
});
vi.mock("@/data/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/members")>();
  return { ...actual, deleteOwnUser: vi.fn(actual.deleteOwnUser) };
});

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// The Build Stages exit condition for Stage E, through the actions:
// suspension, reinstatement and deletion apply their side effects and history
// shows "Former member"; organizer close and retire record their notes (retire
// cancelling an approved loan, OQ-35); the usage numbers match the database;
// the daily job is idempotent and catches up a missed day. By reference:
// `unexpected` (stage-c/unexpected-reported and the action tests), the full
// side-effect cross product (side-effect-matrix), the guards
// (organizer-guard-matrix).

// The formError kinds the Stage E states declare, read from the types.
const STAGE_E_STATES: Record<string, string[]> = {
  "src/types/members.ts": ["MemberStatusState", "DeleteMemberState"],
  "src/types/account.ts": ["DeleteAccountState"],
  "src/types/loan.ts": ["OrganizerCloseState"],
  "src/types/item.ts": ["OrganizerRetireState"],
};

function declaredFormErrors(): Set<string> {
  const kinds = new Set<string>();
  for (const [file, states] of Object.entries(STAGE_E_STATES)) {
    for (const statement of parseFile(file).statements) {
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
        ) {
          continue;
        }
        const type = member.type!;
        for (const option of ts.isUnionTypeNode(type) ? type.types : [type]) {
          if (
            ts.isLiteralTypeNode(option) &&
            ts.isStringLiteral(option.literal)
          ) {
            kinds.add(option.literal.text);
          }
        }
      }
    }
  }
  kinds.delete("unexpected");
  return kinds;
}

const scope = createTestScope();
const reached = new Set<string>();
const TODAY = communityToday();
let organizer: ViewerDTO;
let owner: ViewerDTO;
let borrower: ViewerDTO;

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

type Action = (prev: never, data: FormData) => Promise<unknown>;

async function as(viewer: ViewerDTO, action: Action, data: FormData) {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  try {
    return {
      state: (await action({} as never, data)) as Record<string, unknown>,
      redirected: false,
    };
  } catch (error) {
    if (isRedirectError(error)) return { state: undefined, redirected: true };
    throw error;
  }
}

// A refusal: the expected state, nothing written (`read` before and after),
// no flash and no refresh.
async function refused(
  kind: string,
  read: () => Promise<unknown>,
  run: () => Promise<{ state?: Record<string, unknown> }>,
  expected: Record<string, unknown>,
) {
  const before = await read();
  const { state } = await run();
  expect(state).toMatchObject(expected);
  expect(await read()).toEqual(before);
  expect(setFlash).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  reached.add(kind);
}

async function outLoan(ownerId: string, borrowerId: string) {
  const item = await scope.createItem({ ownerId, status: "listed" });
  const loan = await scope.createLoan({
    itemId: item.id,
    borrowerId,
    status: "out",
    startDate: addDays(TODAY, -2),
    endDate: addDays(TODAY, 1),
  });
  return { itemId: item.id, loanId: loan.id };
}

beforeAll(async () => {
  await assertMigrated();
  mockNextRequest();
  vi.spyOn(auth.api, "signOut").mockResolvedValue({
    headers: new Headers(),
  } as never);
  const [org, own, other] = await Promise.all([
    scope.createTestUser({ name: "Ruth K.", role: "organizer" }),
    scope.createTestUser({ name: "Olga M.", contactDetails: "Phone 1" }),
    scope.createTestUser({ name: "Bora P.", contactDetails: "Phone 2" }),
  ]);
  organizer = viewerOf(org.id, "organizer");
  owner = viewerOf(own.id);
  borrower = viewerOf(other.id);
});
afterAll(() => {
  vi.useRealTimers();
  return scope.cleanup();
});

test("1. a suspension applies every side effect; reinstating restores status only", async () => {
  const subject = viewerOf(
    (await scope.createTestUser({ name: "Sam S.", contactDetails: "P" })).id,
  );
  const ownerItem = await scope.createItem({
    ownerId: owner.id,
    status: "listed",
  });
  const subjectItem = await scope.createItem({
    ownerId: subject.id,
    status: "listed",
  });
  const future = { startDate: addDays(TODAY, 2), endDate: addDays(TODAY, 3) };
  const asBorrower = await scope.createLoan({
    itemId: ownerItem.id,
    borrowerId: subject.id,
    status: "requested",
    ...future,
  });
  const asOwner = await scope.createLoan({
    itemId: subjectItem.id,
    borrowerId: borrower.id,
    status: "approved",
    ...future,
  });
  await createSession(subject.id);

  const suspended = await as(
    organizer,
    suspendMember as Action,
    form({ id: subject.id }),
  );
  expect(suspended.state).toEqual({ flash: "memberSuspended" });
  expect(await loanRow(asBorrower.id)).toMatchObject({
    status: "cancelled",
    endedBy: "system",
    systemReason: "borrower_suspended",
  });
  expect(await loanRow(asOwner.id)).toMatchObject({
    status: "cancelled",
    endedBy: "system",
    systemReason: "owner_suspended",
  });
  expect(await scope.sessionsOf(subject.id)).toEqual([]);
  const after = await memberFootprint(subject.id);
  expect(after.user?.status).toBe("suspended");

  const reinstated = await as(
    organizer,
    reinstateMember as Action,
    form({ id: subject.id }),
  );
  expect(reinstated.state).toEqual({ flash: "memberReinstated" });
  const restored = await memberFootprint(subject.id);
  expect(restored).toEqual({
    ...after,
    user: {
      ...after.user,
      status: "active",
      updatedAt: restored.user!.updatedAt,
    },
  });
});

test('2. a deletion leaves "Former member" on the loan page, My loans and the invitations list', async () => {
  const subject = viewerOf((await scope.createTestUser({ name: "Dee D." })).id);
  const item = await scope.createItem({ ownerId: owner.id, status: "listed" });
  const past = await scope.createLoan({
    itemId: item.id,
    borrowerId: subject.id,
    status: "returned",
    startDate: addDays(TODAY, -10),
    endDate: addDays(TODAY, -8),
  });
  // Created while an organizer, then demoted: the link stays open.
  const invitation = await scope.createInvitation({ createdById: subject.id });

  const deleted = await as(
    subject,
    deleteOwnAccount as Action,
    form({ confirm: "true" }),
  );
  expect(deleted.redirected).toBe(true);
  expect(setFlash).toHaveBeenCalledWith("accountDeleted");
  expect(await db.user.findUnique({ where: { id: subject.id } })).toBeNull();

  const detail = await getLoanForViewer(owner, past.id, TODAY);
  expect(detail?.borrower.displayName).toBe(people.formerMember);
  const lending = await getMyLoans(owner.id, "lending", TODAY);
  const card = Object.values(lending)
    .flat()
    .find(({ id }) => id === past.id);
  expect(card?.otherPartyName).toBe(people.formerMember);
  const row = (await getOpenInvitations()).find(
    ({ id }) => id === invitation.id,
  );
  expect(row?.createdByName).toBe(people.formerMember);
});

test("3. organizer close and retire record their notes; the retire cancels an approved loan", async () => {
  const { loanId } = await outLoan(owner.id, borrower.id);
  const closed = await as(
    organizer,
    closeLoanAsOrganizer as Action,
    form({
      id: loanId,
      returnedOn: TODAY,
      asLent: "unknown",
      note: "Left at the shed",
    }),
  );
  expect(closed.state).toEqual({ flash: "loanClosed" });
  expect(await loanRow(loanId)).toMatchObject({
    status: "returned",
    statusReason: "Left at the shed",
    closedById: organizer.id,
    returnedAsLent: "unknown",
  });
  expect((await getLoanForViewer(owner, loanId, TODAY))?.closedByName).toBe(
    "Ruth K.",
  );

  const item = await scope.createItem({ ownerId: owner.id, status: "listed" });
  const approved = await scope.createLoan({
    itemId: item.id,
    borrowerId: borrower.id,
    status: "approved",
    startDate: addDays(TODAY, 1),
    endDate: addDays(TODAY, 2),
  });
  const retired = await as(
    organizer,
    retireItemAsOrganizer as Action,
    form({ id: item.id, note: "Unsafe cable" }),
  );
  expect(retired.redirected).toBe(true);
  expect(setFlash).toHaveBeenCalledWith("itemRetired");
  expect(
    await db.item.findUniqueOrThrow({ where: { id: item.id } }),
  ).toMatchObject({
    status: "retired",
    retiredNote: "Unsafe cable",
    retiredById: organizer.id,
  });
  expect(await loanRow(approved.id)).toMatchObject({
    status: "cancelled",
    endedBy: "organizer",
    systemReason: "item_retired",
  });
});

test("4. the usage numbers equal the database's own aggregates", async () => {
  await inOneSnapshot(async () => {
    await db.uploadLog.create({ data: { userId: owner.id, bytes: 4_321 } });
    const usage = await getUsage(TODAY);
    const monthStart = communityMidnight(`${TODAY.slice(0, 7)}-01`);
    const [uploads, photos, queued, listed] = await Promise.all([
      db.uploadLog.count({ where: { createdAt: { gte: monthStart } } }),
      db.item.aggregate({ _sum: { photoBytes: true } }),
      db.pendingBlobDeletion.aggregate({ _sum: { bytes: true } }),
      db.item.count({ where: { status: "listed" } }),
    ]);
    expect(usage.uploads.used).toBe(uploads);
    expect(usage.storedBytes.used).toBe(
      (photos._sum.photoBytes ?? 0) + (queued._sum.bytes ?? 0),
    );
    expect(usage.listedItems.used).toBe(listed);
  });
});

test("5. GET /api/cron/daily with the bearer: 200, idempotent, and a missed day caught up", async () => {
  const runNow = new Date("2001-06-13T10:00:00.000Z");
  const runDay = "2001-06-13";
  const item = await scope.createItem({ ownerId: owner.id, status: "listed" });
  const call = () =>
    GET(
      new Request("http://localhost:3000/api/cron/daily", {
        headers: { authorization: `Bearer ${SECRET}` },
      }),
    );

  await inOneSnapshot(async () => {
    // Own rows the job missed for three days, on a 2001 clock.
    const request = await scope.createLoan({
      itemId: item.id,
      borrowerId: borrower.id,
      status: "requested",
      startDate: addDays(runDay, -3),
      endDate: addDays(runDay, -2),
    });
    const invitation = await db.invitation.create({
      data: {
        tokenHash: `${scope.tag}-exit`,
        expiresAt: new Date(runNow.getTime() - 3 * 24 * 60 * 60 * 1000),
      },
    });
    vi.useFakeTimers({ toFake: ["Date"], now: runNow });
    try {
      const first = await call();
      expect(first.status).toBe(200);
      const body = await first.json();
      expect(body).toMatchObject({ ok: true, today: runDay, failed: [] });
      expect((await loanRow(request.id)).status).toBe("expired");
      expect(await db.invitation.count({ where: { id: invitation.id } })).toBe(
        0,
      );

      const second = await call();
      expect(second.status).toBe(200);
      const again = await second.json();
      for (const step of DAILY_JOB_STEPS) {
        if (step !== "retryBlobDeletions") expect(again.counts[step]).toBe(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("every Stage E refusal kind, once, with nothing written", () => {
  test("self", async () => {
    await refused(
      "self",
      () => memberFootprint(organizer.id),
      () => as(organizer, suspendMember as Action, form({ id: organizer.id })),
      { formError: "self" },
    );
  });

  test("stale", async () => {
    await refused(
      "stale",
      () => memberFootprint(owner.id),
      () => as(organizer, reinstateMember as Action, form({ id: owner.id })),
      { formError: "stale" },
    );
  });

  test("lastOrganizer (the data function's refusal, mocked once)", async () => {
    vi.mocked(deleteOwnUser).mockResolvedValueOnce("lastOrganizer");
    await refused(
      "lastOrganizer",
      () => memberFootprint(organizer.id),
      () =>
        as(organizer, deleteOwnAccount as Action, form({ confirm: "true" })),
      { formError: "lastOrganizer" },
    );
  });

  test("itemOut", async () => {
    const target = await scope.createTestUser({
      name: "Sid S.",
      status: "suspended",
    });
    await outLoan(target.id, borrower.id);
    await refused(
      "itemOut",
      () => memberFootprint(target.id),
      () => as(organizer, deleteMember as Action, form({ id: target.id })),
      { formError: "itemOut" },
    );
  });

  test("holdingItem", async () => {
    const holder = viewerOf(
      (await scope.createTestUser({ name: "Hal H." })).id,
    );
    await outLoan(owner.id, holder.id);
    await refused(
      "holdingItem",
      () => memberFootprint(holder.id),
      () => as(holder, deleteOwnAccount as Action, form({ confirm: "true" })),
      { formError: "holdingItem" },
    );
  });

  test("stillOut", async () => {
    const { itemId, loanId } = await outLoan(owner.id, borrower.id);
    await refused(
      "stillOut",
      async () => [
        await db.item.findUniqueOrThrow({ where: { id: itemId } }),
        await loanRow(loanId),
      ],
      () =>
        as(
          organizer,
          retireItemAsOrganizer as Action,
          form({ id: itemId, note: "Broken" }),
        ),
      { formError: "stillOut" },
    );
  });

  test.each([
    ["before the start", -3],
    ["after today", 1],
  ])("fieldErrors.returnedOn: %s", async (_, offset) => {
    const { loanId } = await outLoan(owner.id, borrower.id);
    await refused(
      "fieldErrors.returnedOn",
      () => loanRow(loanId),
      () =>
        as(
          organizer,
          closeLoanAsOrganizer as Action,
          form({
            id: loanId,
            returnedOn: addDays(TODAY, offset),
            asLent: "yes",
            note: "Closed",
          }),
        ),
      { fieldErrors: { returnedOn: expect.any(Array) } },
    );
  });

  test("fieldErrors.note", async () => {
    const { loanId } = await outLoan(owner.id, borrower.id);
    await refused(
      "fieldErrors.note",
      () => loanRow(loanId),
      () =>
        as(
          organizer,
          closeLoanAsOrganizer as Action,
          form({ id: loanId, returnedOn: TODAY, asLent: "yes", note: "  " }),
        ),
      { fieldErrors: { note: expect.any(Array) } },
    );
  });

  test("the reached kinds are every declared formError plus the two field errors", () => {
    expect([...reached].sort()).toEqual(
      [
        ...declaredFormErrors(),
        "fieldErrors.returnedOn",
        "fieldErrors.note",
      ].sort(),
    );
    expect(reached.size).toBe(8);
  });
});
