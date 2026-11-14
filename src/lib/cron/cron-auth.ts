import "server-only";
import { timingSafeEqual } from "node:crypto";

// The daily job's whole authorization: Vercel Cron sends
// `Authorization: Bearer ${CRON_SECRET}`. Without a secret nothing passes.
export function isCronAuthorized(
  authorization: string | null,
  secret: string | undefined,
): boolean {
  if (!secret || authorization === null) return false;
  const given = Buffer.from(authorization);
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length) return false;
  return timingSafeEqual(given, expected);
}
