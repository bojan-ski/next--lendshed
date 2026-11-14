import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT, sourceFiles } from "@/__tests__/support/import-graph";
import { storedFileSize } from "@/__tests__/support/photo-storage";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import { db } from "@/db";
import { addDays, communityMidnight, communityToday } from "@/lib/dates/dates";
import { DAILY_JOB_STEPS, runDailyJob } from "./daily-job";

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

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();

// The job writes app-wide. Every run here sits in a rolled-back snapshot with
// a 2001 clock, on rows created inside it, so only this test's rows match.
// Users and items are committed outside: one created inside would vanish with
// the rollback.
const NOW = new Date("2001-03-10T12:00:00.000Z");
const TODAY = "2001-03-10";
const DAY_MS = 24 * 60 * 60 * 1000;

let ownerId: string;
let borrowerId: string;
const items: string[] = [];

beforeAll(async () => {
  await assertMigrated();
  [ownerId, borrowerId] = await Promise.all([
    scope.createTestUser().then(({ id }) => id),
    scope.createTestUser().then(({ id }) => id),
  ]);
  items.push(
    ...(await Promise.all(
      [1, 2].map(async () => (await scope.createItem({ ownerId })).id),
    )),
  );
});
afterAll(() => scope.cleanup());

const loanStatus = async (id: string) =>
  (await db.loan.findUniqueOrThrow({ where: { id }, select: { status: true } }))
    .status;

describe("runDailyJob", () => {
  test("names its eight steps in the spec's order", () => {
    expect(DAILY_JOB_STEPS).toEqual([
      "storeExpired",
      "storeLapsed",
      "retryBlobDeletions",
      "purgeInvitations",
      "purgeResetGrants",
      "purgeSessions",
      "purgeVerifications",
      "purgeRateLimits",
    ]);
  });

  test("one run catches up missed days on every step; a second run with the same now finds nothing", async () => {
    const outcome = await inOneSnapshot(async () => {
      // A request that started 3 days ago, an approval that ended 5 days ago.
      const request = await scope.createLoan({
        itemId: items[0],
        borrowerId,
        status: "requested",
        startDate: addDays(TODAY, -3),
        endDate: addDays(TODAY, 2),
      });
      const approval = await scope.createLoan({
        itemId: items[1],
        borrowerId,
        status: "approved",
        startDate: addDays(TODAY, -8),
        endDate: addDays(TODAY, -5),
      });
      const photo = await scope.createStoredPhoto();
      await db.pendingBlobDeletion.create({
        data: {
          storageKey: photo.photoKey,
          bytes: photo.photoBytes,
          createdAt: new Date(NOW.getTime() - 2 * DAY_MS),
        },
      });
      // Expired 10 days ago (7-day lifetime).
      const invitation = await scope.createInvitation({
        createdAt: new Date(NOW.getTime() - 17 * DAY_MS),
      });
      const grant = await scope.createResetGrant({
        userId: borrowerId,
        createdAt: new Date(NOW.getTime() - 3 * DAY_MS),
      });
      const session = await db.session.create({
        data: {
          id: randomUUID(),
          token: randomUUID(),
          userId: borrowerId,
          expiresAt: new Date(NOW.getTime() - DAY_MS),
        },
      });
      const verification = await db.verification.create({
        data: {
          id: randomUUID(),
          identifier: scope.email(),
          value: "v",
          expiresAt: new Date(NOW.getTime() - DAY_MS),
        },
      });
      const rateKey = `${scope.ip()}|job`;
      await db.rateLimit.create({
        data: {
          id: randomUUID(),
          key: rateKey,
          count: 1,
          lastRequest: BigInt(NOW.getTime() - 2 * DAY_MS),
        },
      });

      const first = await runDailyJob(NOW);
      const after = {
        request: await loanStatus(request.id),
        approval: await loanStatus(approval.id),
        queueRow: await db.pendingBlobDeletion.findUnique({
          where: { storageKey: photo.photoKey },
        }),
        file: await storedFileSize(photo.photoKey),
        invitation: await db.invitation.findUnique({
          where: { id: invitation.id },
        }),
        grant: await db.passwordResetGrant.findUnique({
          where: { id: grant.id },
        }),
        session: await db.session.findUnique({ where: { id: session.id } }),
        verification: await db.verification.findUnique({
          where: { id: verification.id },
        }),
        rateLimit: await db.rateLimit.findUnique({ where: { key: rateKey } }),
      };
      const second = await runDailyJob(NOW);
      return { first, second, after };
    });

    expect(outcome.first.today).toBe(TODAY);
    expect(outcome.first.today).toBe(communityToday(NOW));
    expect(outcome.first.failed).toEqual([]);
    for (const step of DAILY_JOB_STEPS) {
      expect(outcome.first.counts[step]).toBeGreaterThanOrEqual(1);
    }
    expect(outcome.after).toEqual({
      request: "expired",
      approval: "lapsed",
      queueRow: null,
      file: null,
      invitation: null,
      grant: null,
      session: null,
      verification: null,
      rateLimit: null,
    });

    expect(outcome.second.failed).toEqual([]);
    for (const step of DAILY_JOB_STEPS) {
      if (step === "retryBlobDeletions") continue;
      expect(outcome.second.counts[step]).toBe(0);
    }
  });

  describe.each(TEST_ZONES)(
    "around community midnight (process zone %s)",
    (zone) => {
      useProcessTimeZone(zone);

      test("a request starting D − 1 is tidied from midnight of D, not a millisecond before", async () => {
        const D = TODAY;
        const statuses = await inOneSnapshot(async () => {
          const { id } = await scope.createLoan({
            itemId: items[0],
            borrowerId,
            status: "requested",
            startDate: addDays(D, -1),
            endDate: addDays(D, 1),
          });
          const midnight = communityMidnight(D);
          const before = await runDailyJob(new Date(midnight.getTime() - 1));
          const statusBefore = await loanStatus(id);
          const at = await runDailyJob(midnight);
          return {
            todays: [before.today, at.today],
            statuses: [statusBefore, await loanStatus(id)],
          };
        });
        expect(statuses.todays).toEqual([addDays(D, -1), D]);
        expect(statuses.statuses).toEqual(["requested", "expired"]);
      });
    },
  );
});

describe("runDailyJob — static", () => {
  const STEP_FUNCTIONS = [
    "storeExpiredLoans",
    "storeLapsedLoans",
    "retryPendingBlobDeletions",
    "purgeExpiredInvitations",
    "purgeExpiredResetGrants",
    "purgeExpiredSessions",
    "purgeExpiredVerifications",
    "purgeStaleRateLimits",
  ];

  test("the step functions are called only from runDailyJob", () => {
    const callers = sourceFiles("src/**/*.{ts,tsx}")
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .flatMap((file) => {
        const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
        return STEP_FUNCTIONS.filter((name) =>
          new RegExp(`\\b${name}\\(`).test(
            source.replace(new RegExp(`function ${name}\\(`, "g"), ""),
          ),
        ).map((name) => `${file}#${name}`);
      });
    expect(callers.sort()).toEqual(
      STEP_FUNCTIONS.map((name) => `src/data/daily-job.ts#${name}`).sort(),
    );
  });

  test("the job, its route and its helpers cache nothing", () => {
    for (const file of [
      "src/app/api/cron/daily/route.ts",
      "src/data/daily-job.ts",
      "src/data/auth-housekeeping.ts",
      "src/lib/cron/cron-auth.ts",
    ]) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      expect(source).not.toMatch(
        /use cache|cacheTag|cacheLife|updateTag|revalidateTag|\brefresh\(/,
      );
    }
  });
});
