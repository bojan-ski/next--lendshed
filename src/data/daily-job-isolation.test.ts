import {
  purgeExpiredSessions,
  purgeExpiredVerifications,
  purgeStaleRateLimits,
} from "@/data/auth-housekeeping";
import { retryPendingBlobDeletions } from "@/data/blob-deletions";
import { purgeExpiredInvitations } from "@/data/invitations";
import { storeExpiredLoans, storeLapsedLoans } from "@/data/loans";
import { purgeExpiredResetGrants } from "@/data/reset-grants";
import { communityToday } from "@/lib/dates/dates";
import { reportUnexpected } from "@/lib/feedback/report";
import { DAILY_JOB_STEPS, runDailyJob } from "./daily-job";

// Unit-only: a failing step inside a database transaction would abort it, so
// isolation is proven with the step modules mocked.
vi.mock("@/data/loans", () => ({
  storeExpiredLoans: vi.fn(),
  storeLapsedLoans: vi.fn(),
}));
vi.mock("@/data/blob-deletions", () => ({
  retryPendingBlobDeletions: vi.fn(),
}));
vi.mock("@/data/invitations", () => ({ purgeExpiredInvitations: vi.fn() }));
vi.mock("@/data/reset-grants", () => ({ purgeExpiredResetGrants: vi.fn() }));
vi.mock("@/data/auth-housekeeping", () => ({
  purgeExpiredSessions: vi.fn(),
  purgeExpiredVerifications: vi.fn(),
  purgeStaleRateLimits: vi.fn(),
}));
vi.mock("@/lib/feedback/report", () => ({ reportUnexpected: vi.fn() }));

const STEP_MOCKS = {
  storeExpired: storeExpiredLoans,
  storeLapsed: storeLapsedLoans,
  retryBlobDeletions: retryPendingBlobDeletions,
  purgeInvitations: purgeExpiredInvitations,
  purgeResetGrants: purgeExpiredResetGrants,
  purgeSessions: purgeExpiredSessions,
  purgeVerifications: purgeExpiredVerifications,
  purgeRateLimits: purgeStaleRateLimits,
} as const;

const NOW = new Date("2026-11-14T02:30:00.000Z");
const order: string[] = [];

beforeEach(() => {
  order.length = 0;
  DAILY_JOB_STEPS.forEach((step, index) => {
    vi.mocked(STEP_MOCKS[step]).mockImplementation(async () => {
      order.push(step);
      return index + 1;
    });
  });
});

describe("runDailyJob — step isolation", () => {
  test("runs every step once, in order, with one today and the run's now", async () => {
    const result = await runDailyJob(NOW);
    expect(order).toEqual(DAILY_JOB_STEPS);
    expect(result.today).toBe(communityToday(NOW));
    expect(storeExpiredLoans).toHaveBeenCalledWith(result.today);
    expect(storeLapsedLoans).toHaveBeenCalledWith(result.today);
    for (const step of DAILY_JOB_STEPS.slice(2)) {
      expect(STEP_MOCKS[step]).toHaveBeenCalledWith(NOW);
    }
    expect(result.failed).toEqual([]);
    expect(reportUnexpected).not.toHaveBeenCalled();
  });

  test.each(DAILY_JOB_STEPS)(
    "when %s throws, it is reported and nulled, and the later steps still run",
    async (failing) => {
      const error = new Error("boom");
      vi.mocked(STEP_MOCKS[failing]).mockImplementation(async () => {
        order.push(failing);
        throw error;
      });
      const result = await runDailyJob(NOW);
      expect(order).toEqual(DAILY_JOB_STEPS);
      expect(result.failed).toEqual([failing]);
      expect(result.counts[failing]).toBeNull();
      DAILY_JOB_STEPS.filter((step) => step !== failing).forEach((step) => {
        expect(result.counts[step]).toBe(DAILY_JOB_STEPS.indexOf(step) + 1);
      });
      expect(reportUnexpected).toHaveBeenCalledTimes(1);
      expect(reportUnexpected).toHaveBeenCalledWith(
        `dailyJob:${failing}`,
        error,
      );
    },
  );
});
