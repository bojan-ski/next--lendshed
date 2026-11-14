import "server-only";
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
import type { DailyJobResult, DailyJobStep } from "@/types/daily-job";

export const DAILY_JOB_STEPS = [
  "storeExpired",
  "storeLapsed",
  "retryBlobDeletions",
  "purgeInvitations",
  "purgeResetGrants",
  "purgeSessions",
  "purgeVerifications",
  "purgeRateLimits",
] as const satisfies readonly DailyJobStep[];

// Every predicate is "before today / now", so a missed day is caught up by the
// next run and a second run finds nothing left to do.
export async function runDailyJob(now: Date): Promise<DailyJobResult> {
  const today = communityToday(now);
  const run: Record<DailyJobStep, () => Promise<number>> = {
    storeExpired: () => storeExpiredLoans(today),
    storeLapsed: () => storeLapsedLoans(today),
    retryBlobDeletions: () => retryPendingBlobDeletions(now),
    purgeInvitations: () => purgeExpiredInvitations(now),
    purgeResetGrants: () => purgeExpiredResetGrants(now),
    purgeSessions: () => purgeExpiredSessions(now),
    purgeVerifications: () => purgeExpiredVerifications(now),
    purgeRateLimits: () => purgeStaleRateLimits(now),
  };
  const counts = {} as Record<DailyJobStep, number | null>;
  const failed: DailyJobStep[] = [];
  for (const step of DAILY_JOB_STEPS) {
    try {
      counts[step] = await run[step]();
    } catch (error) {
      reportUnexpected(`dailyJob:${step}`, error);
      counts[step] = null;
      failed.push(step);
    }
  }
  return { today, counts, failed };
}
