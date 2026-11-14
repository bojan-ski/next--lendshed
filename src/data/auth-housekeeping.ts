import "server-only";
import { db } from "@/db";

// Far above the library's longest rate-limit window (60 s), so a live window
// is never reset.
export const RATE_LIMIT_PURGE_AGE_MS = 24 * 60 * 60 * 1000;

// The library refuses an expired session itself; deleting one changes no
// sign-in outcome.
export async function purgeExpiredSessions(now: Date): Promise<number> {
  const { count } = await db.session.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}

export async function purgeExpiredVerifications(now: Date): Promise<number> {
  const { count } = await db.verification.deleteMany({
    where: { expiresAt: { lt: now } },
  });
  return count;
}

// `lastRequest` is epoch milliseconds.
export async function purgeStaleRateLimits(now: Date): Promise<number> {
  const { count } = await db.rateLimit.deleteMany({
    where: {
      lastRequest: { lt: BigInt(now.getTime() - RATE_LIMIT_PURGE_AGE_MS) },
    },
  });
  return count;
}
