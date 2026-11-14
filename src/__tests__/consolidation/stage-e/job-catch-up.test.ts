import { randomBytes } from "node:crypto";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { DAILY_JOB_STEPS, runDailyJob } from "@/data/daily-job";
import { fromDbDate, toDbDate } from "@/data/db-dates";
import { deleteOwnUser, suspendMemberAccount } from "@/data/members";
import { getUsage } from "@/data/photos";
import { db } from "@/db";
import type { LoanStatus } from "@/generated/prisma/enums";
import { addDays, communityToday } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { loanStatus } from "@/lib/text/status";
import type { EffectiveLoanStatus } from "@/types/loan";

vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);
vi.mock("@/db", async (importOriginal) =>
  (await import("@/__tests__/support/snapshot")).snapshotDbModule(
    await importOriginal<typeof import("@/db")>(),
  ),
);
vi.mock("@/lib/feedback/report", () => ({ reportUnexpected: vi.fn() }));

vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

// The daily job's exit proofs: it never changes what a screen derives, one run
// catches up every missed day, a second run finds nothing, and its writes meet
// Stage E's sweeps without overlap. Everything runs in a rolled-back snapshot
// on a 2001 clock with the test's own rows dated before it
// (.claude/rules/testing.md), so only they match. Users and items are
// committed outside the snapshot.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// D is the last day the job ran; it then missed two days and runs on D + 3.
const D = "2001-01-10";
const RUN_DAY = addDays(D, 3);
const at = (day: string) => new Date(`${day}T10:00:00.000Z`);
const RUN_NOW = at(RUN_DAY);
const AGES = [1, 3, 10];
// Steps whose second run must find nothing at all, app-wide.
const IDEMPOTENT_STEPS = DAILY_JOB_STEPS.filter(
  (step) => step !== "retryBlobDeletions",
);

// The stored row behind each effective status on `today`, in days from it.
const STORED: Record<
  EffectiveLoanStatus,
  { status: LoanStatus; from: number; to: number }
> = {
  requested: { status: "requested", from: 1, to: 2 },
  approved: { status: "approved", from: 0, to: 2 },
  out: { status: "out", from: -1, to: 1 },
  overdue: { status: "out", from: -3, to: -1 },
  returned: { status: "returned", from: -5, to: -3 },
  declined: { status: "declined", from: 1, to: 2 },
  cancelled: { status: "cancelled", from: 1, to: 2 },
  expired: { status: "requested", from: -2, to: -1 },
  lapsed: { status: "approved", from: -4, to: -1 },
};

const scope = createTestScope();
let ownerId: string;
let borrowerId: string;
let sessionUserId: string;
const freeItems: string[] = [];
let itemCursor = 0;
const nextItem = () => freeItems[itemCursor++];

// Rows swept by Stage E's workflows, committed through the real functions.
let sweptIds: string[] = [];
let nulledExpiredId: string;

beforeAll(async () => {
  await assertMigrated();
  const [owner, borrower, sessionUser, organizer, suspendee, deletee] =
    await Promise.all([
      scope.createTestUser({ name: "Olga M." }),
      scope.createTestUser({ name: "Bora P." }),
      scope.createTestUser({ name: "Ivo N." }),
      scope.createTestUser({ name: "Ruth K.", role: "organizer" }),
      scope.createTestUser({ name: "Sam S." }),
      scope.createTestUser({ name: "Dee D." }),
    ]);
  ownerId = owner.id;
  borrowerId = borrower.id;
  sessionUserId = sessionUser.id;
  for (let i = 0; i < 24; i++) {
    freeItems.push((await scope.createItem({ ownerId, status: "listed" })).id);
  }

  // A suspension sweeps the suspendee's request and approval (borrower side)
  // and a request on their item (owner side).
  const today = communityToday();
  const suspendeeItem = await scope.createItem({
    ownerId: suspendee.id,
    status: "listed",
  });
  const future = { startDate: addDays(today, 2), endDate: addDays(today, 3) };
  const swept = await Promise.all([
    scope.createLoan({
      itemId: nextItem(),
      borrowerId: suspendee.id,
      status: "requested",
      ...future,
    }),
    scope.createLoan({
      itemId: nextItem(),
      borrowerId: suspendee.id,
      status: "approved",
      ...future,
    }),
    scope.createLoan({
      itemId: suspendeeItem.id,
      borrowerId,
      status: "requested",
      ...future,
    }),
  ]);
  // A deletion sweeps the deletee's request and leaves an expired one alone.
  const deleteeSwept = await scope.createLoan({
    itemId: nextItem(),
    borrowerId: deletee.id,
    status: "requested",
    ...future,
  });
  const expired = await scope.createLoan({
    itemId: nextItem(),
    borrowerId: deletee.id,
    status: "requested",
    startDate: addDays(today, -2),
    endDate: addDays(today, -1),
  });
  expect(
    await suspendMemberAccount({
      actorId: organizer.id,
      memberId: suspendee.id,
      today,
    }),
  ).toBe("suspended");
  expect(await deleteOwnUser(deletee.id, today)).toBe("deleted");
  sweptIds = [...swept.map(({ id }) => id), deleteeSwept.id];
  nulledExpiredId = expired.id;
});
afterAll(() => scope.cleanup());

// Loans are created inside the snapshot, on committed items.
function createLoan(status: LoanStatus, startDate: string, endDate: string) {
  return scope.createLoan({
    itemId: nextItem(),
    borrowerId,
    status,
    startDate,
    endDate,
  });
}

const row = (id: string) => db.loan.findUniqueOrThrow({ where: { id } });
const readStatus = async (id: string, today: string) => {
  const loan = await row(id);
  return effectiveStatus(
    {
      status: loan.status,
      startDate: fromDbDate(loan.startDate),
      endDate: fromDbDate(loan.endDate),
    },
    today,
  );
};
const without = (loan: object, keys: string[]) =>
  Object.fromEntries(
    Object.entries(loan).filter(([key]) => !keys.includes(key)),
  );

test("the tidy never changes an effective status and writes only status", async () => {
  const statuses = Object.keys(loanStatus) as EffectiveLoanStatus[];
  expect(statuses).toHaveLength(9);
  await inOneSnapshot(async () => {
    const loans = await Promise.all(
      statuses.map(async (status) => {
        const { status: stored, from, to } = STORED[status];
        const { id } = await createLoan(
          stored,
          addDays(RUN_DAY, from),
          addDays(RUN_DAY, to),
        );
        return { id, status, before: await row(id) };
      }),
    );
    for (const { id, status } of loans) {
      expect(await readStatus(id, RUN_DAY)).toBe(status);
    }

    expect((await runDailyJob(RUN_NOW)).failed).toEqual([]);

    for (const { id, status, before } of loans) {
      expect(await readStatus(id, RUN_DAY)).toBe(status);
      const after = await row(id);
      expect(without(after, ["status", "updatedAt"])).toEqual(
        without(before, ["status", "updatedAt"]),
      );
      if (status === "expired" || status === "lapsed") {
        expect(after.status).toBe(status);
      } else {
        expect(after.status).toBe(before.status);
      }
    }
  });
});

describe("missed days, idempotence and the next day", () => {
  // Own rows aged 1, 3 and 10 days past their cutoff on the run day, plus one
  // control per kind whose cutoff is the run day itself.
  async function ownRows(now: Date, today: string) {
    const ip = scope.ip();
    const tag = randomBytes(4).toString("hex");
    const kinds = {
      request: (age: number) =>
        createLoan("requested", addDays(today, -age), addDays(today, -age + 1)),
      approval: (age: number) =>
        createLoan("approved", addDays(today, -age - 1), addDays(today, -age)),
      invitation: async (age: number) =>
        db.invitation.create({
          data: {
            tokenHash: `${tag}-inv-${age}`,
            createdAt: new Date(now.getTime() - (age + 7) * DAY_MS),
            expiresAt: new Date(now.getTime() - age * DAY_MS),
          },
        }),
      grant: async (age: number) =>
        db.passwordResetGrant.create({
          data: {
            userId: sessionUserId,
            tokenHash: `${tag}-grant-${age}`,
            createdAt: new Date(now.getTime() - age * DAY_MS - HOUR_MS),
            expiresAt: new Date(now.getTime() - age * DAY_MS),
          },
        }),
      session: async (age: number) =>
        db.session.create({
          data: {
            id: `${tag}-session-${age}`,
            token: `${tag}-session-${age}`,
            userId: sessionUserId,
            expiresAt: new Date(now.getTime() - age * DAY_MS),
          },
        }),
      verification: async (age: number) =>
        db.verification.create({
          data: {
            id: `${tag}-verification-${age}`,
            identifier: `${tag}-${age}`,
            value: "x",
            expiresAt: new Date(now.getTime() - age * DAY_MS),
          },
        }),
      rateLimit: async (age: number) =>
        db.rateLimit.create({
          data: {
            id: `${tag}-rate-${age}`,
            key: `${ip}|/sign-in/email-${age}`,
            count: 1,
            lastRequest: BigInt(now.getTime() - DAY_MS - age * DAY_MS),
          },
        }),
    };
    const aged: Record<string, string[]> = {};
    const controls: Record<string, string> = {};
    for (const [kind, make] of Object.entries(kinds)) {
      aged[kind] = [];
      for (const age of AGES) aged[kind].push((await make(age)).id);
      // Due on the run day exactly: not yet, until the next day.
      controls[kind] = (await make(0)).id;
    }
    return { aged, controls };
  }

  const present = {
    request: (id: string) =>
      row(id).then(({ status }) => status === "requested"),
    approval: (id: string) =>
      row(id).then(({ status }) => status === "approved"),
    invitation: (id: string) =>
      db.invitation.count({ where: { id } }).then((n) => n === 1),
    grant: (id: string) =>
      db.passwordResetGrant.count({ where: { id } }).then((n) => n === 1),
    session: (id: string) =>
      db.session.count({ where: { id } }).then((n) => n === 1),
    verification: (id: string) =>
      db.verification.count({ where: { id } }).then((n) => n === 1),
    rateLimit: (id: string) =>
      db.rateLimit.count({ where: { id } }).then((n) => n === 1),
  } satisfies Record<string, (id: string) => Promise<boolean>>;

  async function stillThere(ids: Record<string, string[]>) {
    const out: Record<string, boolean[]> = {};
    for (const [kind, list] of Object.entries(ids)) {
      out[kind] = await Promise.all(
        list.map((id) => present[kind as keyof typeof present](id)),
      );
    }
    return out;
  }

  test("one run on D + 3 catches up every aged row; the same run again does nothing; D + 4 takes only the newly aged", async () => {
    await inOneSnapshot(async () => {
      const { aged, controls } = await ownRows(RUN_NOW, RUN_DAY);
      const controlIds = Object.fromEntries(
        Object.entries(controls).map(([kind, id]) => [kind, [id]]),
      );

      const first = await runDailyJob(RUN_NOW);
      expect(first.failed).toEqual([]);
      expect(first.today).toBe(RUN_DAY);
      for (const flags of Object.values(await stillThere(aged))) {
        expect(flags).toEqual([false, false, false]);
      }
      for (const flags of Object.values(await stillThere(controlIds))) {
        expect(flags).toEqual([true]);
      }

      const again = await runDailyJob(RUN_NOW);
      expect(again.failed).toEqual([]);
      for (const step of IDEMPOTENT_STEPS) expect(again.counts[step]).toBe(0);

      const nextDay = await runDailyJob(new Date(RUN_NOW.getTime() + DAY_MS));
      expect(nextDay.failed).toEqual([]);
      for (const flags of Object.values(await stillThere(controlIds))) {
        expect(flags).toEqual([false]);
      }
      // The controls were the only rows left to age, own or anyone's.
      for (const step of IDEMPOTENT_STEPS) {
        expect(nextDay.counts[step]).toBe(1);
      }
    });
  });
});

describe("with Stage E's sweeps", () => {
  test("loans swept by suspension or deletion are never matched; a deletion's expired request with no borrower is tidied", async () => {
    await inOneSnapshot(async () => {
      // Dated before the run day, so only their status keeps the tidy away.
      const old = {
        startDate: toDbDate("2000-12-01"),
        endDate: toDbDate("2000-12-02"),
      };
      await db.loan.updateMany({
        where: { id: { in: [...sweptIds, nulledExpiredId] } },
        data: old,
      });
      const before = await Promise.all(sweptIds.map(row));
      expect(before.map(({ status }) => status).sort()).toEqual([
        "cancelled",
        "cancelled",
        "cancelled",
        "declined",
      ]);
      expect((await row(nulledExpiredId)).borrowerId).toBeNull();
      expect((await row(nulledExpiredId)).status).toBe("requested");

      expect((await runDailyJob(RUN_NOW)).failed).toEqual([]);

      expect(await Promise.all(sweptIds.map(row))).toEqual(before);
      expect((await row(nulledExpiredId)).status).toBe("expired");
    });
  });

  test("a blob retry lowers stored bytes by exactly the bytes of the rows it removed", async () => {
    await inOneSnapshot(async () => {
      const own = await db.pendingBlobDeletion.create({
        data: {
          storageKey: `${scope.tag}/${randomBytes(4).toString("hex")}.webp`,
          bytes: 123_457,
          createdAt: new Date(RUN_NOW.getTime() - 2 * HOUR_MS),
        },
      });
      const queued = await db.pendingBlobDeletion.findMany();
      const usedBefore = (await getUsage(RUN_DAY)).storedBytes.used;

      const result = await runDailyJob(RUN_NOW);
      expect(result.failed).toEqual([]);

      const left = new Set(
        (await db.pendingBlobDeletion.findMany()).map(({ id }) => id),
      );
      const removed = queued.filter(({ id }) => !left.has(id));
      expect(removed.map(({ id }) => id)).toContain(own.id);
      expect(result.counts.retryBlobDeletions).toBe(removed.length);
      const usedAfter = (await getUsage(RUN_DAY)).storedBytes.used;
      expect(usedBefore - usedAfter).toBe(
        removed.reduce((sum, { bytes }) => sum + bytes, 0),
      );
    });
  });
});
