import { isRedirectError } from "next/dist/client/components/redirect-error";
import { refresh } from "next/cache";
import { loanRow } from "@/__tests__/support/loan-fixtures";
import { runAs, transitionForm } from "@/__tests__/support/loan-transitions";
import {
  createSideCell,
  inBatches,
  type MemberSide,
  memberFootprint,
  trackItemPhoto,
  viewerOf,
} from "@/__tests__/support/member-fixtures";
import { mockNextRequest } from "@/__tests__/support/next-request";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { deleteOwnAccount } from "@/actions/account";
import {
  deleteMember,
  reinstateMember,
  suspendMember,
} from "@/actions/members";
import { deletePendingBlobs } from "@/data/blob-deletions";
import { getLoanForViewer } from "@/data/loans";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import type { LoanSystemReason } from "@/generated/prisma/enums";
import { auth } from "@/lib/auth/auth";
import { addDays, communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { reportUnexpected } from "@/lib/feedback/report";
import { loanStatus } from "@/lib/text/status";
import type { EffectiveLoanStatus } from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/feedback/flash", () => ({ setFlash: vi.fn() }));
vi.mock("@/lib/feedback/report", () => ({ reportUnexpected: vi.fn() }));
vi.mock("@/lib/auth/sign-in", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/sign-in")>();
  return { ...actual, copySetCookies: vi.fn() };
});
// Queue rows stay where the transaction left them, so they can be counted.
vi.mock("@/data/blob-deletions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/blob-deletions")>();
  return { ...actual, deletePendingBlobs: vi.fn(async () => undefined) };
});

vi.setConfig({ testTimeout: 120_000, hookTimeout: 600_000 });

// The Member Lifecycle's side effects for the three workflows that end a
// member's access, as one cross product: workflow × the member's side of the
// loan × every effective status, each cell its own member with one loan. One
// oracle, written once, for all three. Per-workflow rows and the held-row
// concurrency tests live in src/data/members.test.ts.

const WORKFLOWS = [
  "suspendMember",
  "deleteOwnAccount",
  "deleteMember",
] as const;
type Workflow = (typeof WORKFLOWS)[number];
const SIDES: MemberSide[] = ["borrower", "owner"];
const STATUSES = Object.keys(loanStatus) as EffectiveLoanStatus[];

const SWEPT = new Set<EffectiveLoanStatus>(["requested", "approved"]);
const OCCUPYING = new Set<EffectiveLoanStatus>(["out", "overdue"]);
const deleting = (workflow: Workflow) => workflow !== "suspendMember";

const scope = createTestScope();
const TODAY = communityToday();
let organizer: ViewerDTO;
let counterpart: ViewerDTO;

type Outcome = { state?: Record<string, unknown>; redirected: boolean };

async function run(workflow: Workflow, subject: ViewerDTO): Promise<Outcome> {
  const data = new FormData();
  if (workflow === "deleteOwnAccount") data.set("confirm", "true");
  else data.set("id", subject.id);
  vi.mocked(getViewer).mockResolvedValue(
    workflow === "deleteOwnAccount" ? subject : organizer,
  );
  const action = { suspendMember, deleteOwnAccount, deleteMember }[workflow];
  try {
    return { state: await action({}, data), redirected: false };
  } catch (error) {
    if (isRedirectError(error)) return { redirected: true };
    throw error;
  }
}

function expectSucceeded(workflow: Workflow, outcome: Outcome): void {
  if (workflow === "suspendMember") {
    expect(outcome.state).toEqual({ flash: "memberSuspended" });
    expect(refresh).toHaveBeenCalledOnce();
    return;
  }
  expect(outcome.redirected).toBe(true);
  expect(setFlash).toHaveBeenCalledWith(
    workflow === "deleteMember" ? "memberDeleted" : "accountDeleted",
  );
  expect(refresh).not.toHaveBeenCalled();
}

function reasonFor(workflow: Workflow, side: MemberSide): LoanSystemReason {
  if (deleting(workflow)) return "account_deleted";
  return side === "borrower" ? "borrower_suspended" : "owner_suspended";
}

// A loan on a fresh item of the counterpart's, in a stored status.
async function borrowFromCounterpart(
  borrowerId: string,
  status: "requested" | "cancelled",
): Promise<string> {
  const item = await scope.createItem({
    ownerId: counterpart.id,
    status: "listed",
  });
  const { id } = await scope.createLoan({
    itemId: item.id,
    borrowerId,
    status,
    startDate: addDays(TODAY, 2),
    endDate: addDays(TODAY, 3),
  });
  return id;
}

const without = (row: object, keys: string[]) =>
  Object.fromEntries(
    Object.entries(row).filter(([key]) => !keys.includes(key)),
  );

beforeAll(async () => {
  await assertMigrated();
  mockNextRequest();
  vi.spyOn(auth.api, "signOut").mockResolvedValue({
    headers: new Headers(),
  } as never);
  const [org, other] = await Promise.all([
    scope.createTestUser({ name: "Ruth K.", role: "organizer" }),
    scope.createTestUser({ name: "Olga M.", contactDetails: "Phone 1" }),
  ]);
  organizer = viewerOf(org.id, "organizer");
  counterpart = viewerOf(other.id);
});
afterAll(() => scope.cleanup());

test("the dimensions are 3 workflows × 2 sides × the 9 effective statuses", () => {
  expect(WORKFLOWS).toHaveLength(3);
  expect(SIDES).toHaveLength(2);
  expect(STATUSES).toHaveLength(9);
});

describe.each(WORKFLOWS)("%s", (workflow) => {
  const cells = new Map<
    string,
    { subject: ViewerDTO; loanId: string; itemId: string }
  >();
  const combos = SIDES.flatMap((side) =>
    STATUSES.map((status) => ({ side, status })),
  );

  beforeAll(async () => {
    const built = await inBatches(combos, (combo) =>
      createSideCell(scope, {
        ...combo,
        today: TODAY,
        counterpart,
        subjectStatus: workflow === "deleteMember" ? "suspended" : "active",
      }),
    );
    combos.forEach(({ side, status }, i) =>
      cells.set(`${side}:${status}`, built[i]),
    );
  });

  test.each(combos)("$side × $status", async ({ side, status }) => {
    const cell = cells.get(`${side}:${status}`)!;
    const id = cell.subject.id;
    const footprint = await memberFootprint(id);
    const before = await loanRow(cell.loanId);
    const t0 = new Date();
    const outcome = await run(workflow, cell.subject);
    const t1 = new Date();
    expect(reportUnexpected).not.toHaveBeenCalled();

    if (deleting(workflow) && OCCUPYING.has(status)) {
      expect(outcome.state).toEqual({
        formError: side === "owner" ? "itemOut" : "holdingItem",
      });
      expect(await memberFootprint(id)).toEqual(footprint);
      expect(deletePendingBlobs).not.toHaveBeenCalled();
      expect(setFlash).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      return;
    }

    expectSucceeded(workflow, outcome);
    const loan = await loanRow(cell.loanId);
    const nulledBorrower = deleting(workflow) && side === "borrower";

    if (SWEPT.has(status)) {
      const departing = side === "borrower" ? "borrowerSeenAt" : "ownerSeenAt";
      const other = side === "borrower" ? "ownerSeenAt" : "borrowerSeenAt";
      expect(loan).toMatchObject({
        status:
          side === "owner" && status === "requested" ? "declined" : "cancelled",
        endedBy: "system",
        systemReason: reasonFor(workflow, side),
        statusReason: null,
        borrowerId: nulledBorrower ? null : before.borrowerId,
      });
      expect(loan.changedAt.getTime()).toBeGreaterThanOrEqual(t0.getTime());
      expect(loan.changedAt.getTime()).toBeLessThanOrEqual(t1.getTime());
      expect(loan[departing]).toEqual(loan.changedAt);
      expect(loan[other]).toEqual(before[other]);
      const written = [
        "status",
        "endedBy",
        "systemReason",
        "changedAt",
        departing,
        "borrowerId",
        "updatedAt",
      ];
      expect(without(loan, written)).toEqual(without(before, written));
    } else {
      expect(loan).toEqual(
        nulledBorrower ? { ...before, borrowerId: null } : before,
      );
    }

    expect(await db.session.count({ where: { userId: id } })).toBe(0);
    const user = await db.user.findUnique({ where: { id } });
    if (deleting(workflow)) expect(user).toBeNull();
    else expect(user?.status).toBe("suspended");
  });
});

describe("invitations: target role × invitation state × workflow", () => {
  const cases = WORKFLOWS.flatMap((workflow) =>
    (["member", "organizer"] as const).map((role) => ({ workflow, role })),
  );

  test.each(cases)("$workflow on a $role", async ({ workflow, role }) => {
    const created = await scope.createTestUser({
      name: "Sam S.",
      role,
      status: workflow === "deleteMember" ? "suspended" : "active",
    });
    const subject = viewerOf(created.id, role);
    // A swept request shares the workflow's `now` with the revocation.
    const loanId = await borrowFromCounterpart(subject.id, "requested");
    const states = ["open", "used", "expired", "revoked"] as const;
    const invitations = await Promise.all(
      states.map((state) =>
        scope.createInvitation({ state, createdById: subject.id }),
      ),
    );
    const usedBy = await scope.createInvitation({ state: "used" });
    await db.invitation.update({
      where: { id: usedBy.id },
      data: { usedById: subject.id },
    });
    const ids = [...invitations.map(({ id }) => id), usedBy.id];
    const read = () =>
      db.invitation.findMany({
        where: { id: { in: ids } },
        orderBy: { id: "asc" },
      });
    const before = new Map((await read()).map((row) => [row.id, row]));

    expectSucceeded(workflow, await run(workflow, subject));
    expect(reportUnexpected).not.toHaveBeenCalled();
    const { changedAt } = await loanRow(loanId);
    const after = new Map((await read()).map((row) => [row.id, row]));
    expect(after.size).toBe(ids.length);

    states.forEach((state, i) => {
      const row = after.get(invitations[i].id)!;
      const was = before.get(invitations[i].id)!;
      const revoked = state === "open" && role === "organizer";
      expect(row.revokedAt).toEqual(revoked ? changedAt : was.revokedAt);
    });
    for (const [id, row] of after) {
      const was = before.get(id)!;
      expect(row.createdById).toBe(deleting(workflow) ? null : was.createdById);
      expect(row.usedById).toBe(deleting(workflow) ? null : was.usedById);
    }
  });
});

describe.each(["deleteOwnAccount", "deleteMember"] as const)(
  "%s: deletion items",
  (workflow) => {
    test("{hidden, listed, retired} × {no loan rows, loan rows}", async () => {
      const created = await scope.createTestUser({
        name: "Sam S.",
        status: workflow === "deleteMember" ? "suspended" : "active",
      });
      const subject = viewerOf(created.id);
      const kinds = (["hidden", "listed", "retired"] as const).flatMap(
        (status) => [false, true].map((lent) => ({ status, lent })),
      );
      const items = await inBatches(kinds, async ({ status, lent }) => {
        const { id } = await scope.createItem({
          ownerId: subject.id,
          status,
          photo: status !== "retired",
        });
        const key = await trackItemPhoto(scope, id);
        if (lent) {
          await scope.createLoan({
            itemId: id,
            borrowerId: counterpart.id,
            status: "returned",
            startDate: addDays(TODAY, -20),
            endDate: addDays(TODAY, -18),
          });
        }
        return { id, key, status, lent };
      });
      const before = new Map(
        (
          await db.item.findMany({
            where: { id: { in: items.map(({ id }) => id) } },
          })
        ).map((row) => [row.id, row]),
      );

      const t0 = new Date();
      expectSucceeded(workflow, await run(workflow, subject));
      const t1 = new Date();
      expect(reportUnexpected).not.toHaveBeenCalled();

      const queued = items.flatMap(({ key }) => (key ? [key] : []));
      expect(queued).toHaveLength(4);
      for (const item of items) {
        const row = await db.item.findUnique({ where: { id: item.id } });
        if (item.status === "retired") {
          expect(row).toEqual({ ...before.get(item.id), ownerId: null });
        } else if (!item.lent) {
          expect(row).toBeNull();
        } else {
          expect(row).toMatchObject({
            status: "retired",
            ownerId: null,
            retiredNote: null,
            retiredById: null,
            photoKey: null,
            photoUrl: null,
            photoWidth: null,
            photoHeight: null,
            photoBytes: null,
          });
          expect(row!.retiredAt!.getTime()).toBeGreaterThanOrEqual(
            t0.getTime(),
          );
          expect(row!.retiredAt!.getTime()).toBeLessThanOrEqual(t1.getTime());
        }
      }
      const rows = await db.pendingBlobDeletion.findMany({
        where: { storageKey: { in: queued } },
      });
      expect(rows.map(({ storageKey }) => storageKey).sort()).toEqual(
        [...queued].sort(),
      );
      expect(rows.every(({ bytes }) => bytes === 120_000)).toBe(true);
      expect(deletePendingBlobs).toHaveBeenCalledOnce();
      expect(
        [...vi.mocked(deletePendingBlobs).mock.calls[0][0]].sort(),
      ).toEqual([...queued].sort());
    });

    test("every user FK is nulled; the member's own grants are deleted", async () => {
      const created = await scope.createTestUser({
        name: "Sam S.",
        status: workflow === "deleteMember" ? "suspended" : "active",
      });
      const subject = viewerOf(created.id);
      const item = await scope.createItem({
        ownerId: counterpart.id,
        status: "listed",
      });
      const past = (from: number) => ({
        itemId: item.id,
        status: "returned" as const,
        startDate: addDays(TODAY, from),
        endDate: addDays(TODAY, from + 1),
      });
      const borrowed = await scope.createLoan({
        ...past(-30),
        borrowerId: subject.id,
      });
      const closed = await scope.createLoan({
        ...past(-27),
        borrowerId: counterpart.id,
        closedById: subject.id,
      });
      const retired = await scope.createItem({
        ownerId: counterpart.id,
        status: "retired",
      });
      await db.item.update({
        where: { id: retired.id },
        data: { retiredById: subject.id, retiredNote: "Broken" },
      });
      const givenGrant = await scope.createResetGrant({
        userId: counterpart.id,
        createdById: subject.id,
      });
      const ownGrant = await scope.createResetGrant({ userId: subject.id });
      const upload = await db.uploadLog.create({
        data: {
          userId: subject.id,
          bytes: 1,
          createdAt: new Date("2001-01-01T00:00:00Z"),
        },
      });

      try {
        expectSucceeded(workflow, await run(workflow, subject));
        expect(reportUnexpected).not.toHaveBeenCalled();
        expect((await loanRow(borrowed.id)).borrowerId).toBeNull();
        expect((await loanRow(closed.id)).closedById).toBeNull();
        expect(
          await db.item.findUniqueOrThrow({ where: { id: retired.id } }),
        ).toMatchObject({ retiredById: null, retiredNote: "Broken" });
        expect(
          await db.passwordResetGrant.findUniqueOrThrow({
            where: { id: givenGrant.id },
          }),
        ).toMatchObject({ createdById: null });
        expect(
          await db.passwordResetGrant.findUnique({
            where: { id: ownGrant.id },
          }),
        ).toBeNull();
        expect(
          await db.uploadLog.findUniqueOrThrow({ where: { id: upload.id } }),
        ).toMatchObject({ userId: null });
      } finally {
        await db.uploadLog.deleteMany({ where: { id: upload.id } });
      }
    });
  },
);

describe.each(["deleteOwnAccount", "deleteMember"] as const)(
  "%s: refusal precedence",
  (workflow) => {
    test("an item out and one held → itemOut first, nothing written", async () => {
      const created = await scope.createTestUser({
        name: "Sam S.",
        status: workflow === "deleteMember" ? "suspended" : "active",
      });
      const subject = viewerOf(created.id);
      const out = { startDate: addDays(TODAY, -1), endDate: addDays(TODAY, 1) };
      const own = await scope.createItem({
        ownerId: subject.id,
        status: "listed",
      });
      await scope.createLoan({
        itemId: own.id,
        borrowerId: counterpart.id,
        status: "out",
        ...out,
      });
      const theirs = await scope.createItem({
        ownerId: counterpart.id,
        status: "listed",
      });
      await scope.createLoan({
        itemId: theirs.id,
        borrowerId: subject.id,
        status: "out",
        ...out,
      });
      const before = await memberFootprint(subject.id);

      const outcome = await run(workflow, subject);
      expect(outcome.state).toEqual({ formError: "itemOut" });
      expect(await memberFootprint(subject.id)).toEqual(before);
      expect(setFlash).not.toHaveBeenCalled();
    });
  },
);

test("reinstate writes status only", async () => {
  const created = await scope.createTestUser({
    name: "Sam S.",
    status: "suspended",
  });
  const subject = viewerOf(created.id);
  const loanId = await borrowFromCounterpart(subject.id, "cancelled");
  await db.loan.update({
    where: { id: loanId },
    data: { endedBy: "system", systemReason: "borrower_suspended" },
  });
  await scope.createInvitation({ state: "revoked", createdById: subject.id });
  const before = await memberFootprint(subject.id);

  const data = new FormData();
  data.set("id", subject.id);
  vi.mocked(getViewer).mockResolvedValue(organizer);
  expect(await reinstateMember({}, data)).toEqual({
    flash: "memberReinstated",
  });

  const after = await memberFootprint(subject.id);
  expect(after.user).toEqual({
    ...before.user,
    status: "active",
    updatedAt: after.user!.updatedAt,
  });
  expect(without(after, ["user"])).toEqual(without(before, ["user"]));
});

describe("after a suspension", () => {
  test("a borrower-suspended out loan can still be marked back by the active owner", async () => {
    const { subject, loanId } = await createSideCell(scope, {
      side: "borrower",
      status: "out",
      today: TODAY,
      counterpart,
    });
    expectSucceeded("suspendMember", await run("suspendMember", subject));
    vi.mocked(refresh).mockClear();

    const state = await runAs(
      counterpart,
      "markLoanReturned",
      transitionForm("markLoanReturned", loanId, "out", TODAY),
    );
    expect(state).toEqual({ flash: "loanReturned" });
    expect((await loanRow(loanId)).status).toBe("returned");
  });

  test("an owner-suspended out loan offers a non-party organizer only organizer_close", async () => {
    const { subject, loanId } = await createSideCell(scope, {
      side: "owner",
      status: "out",
      today: TODAY,
      counterpart,
    });
    expectSucceeded("suspendMember", await run("suspendMember", subject));
    expect((await loanRow(loanId)).returnedOn).toBeNull();

    const detail = await getLoanForViewer(organizer, loanId, TODAY);
    expect(detail?.actions).toEqual(["organizer_close"]);
  });
});
