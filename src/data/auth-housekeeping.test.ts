import { randomUUID } from "node:crypto";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import {
  purgeExpiredSessions,
  purgeExpiredVerifications,
  purgeStaleRateLimits,
  RATE_LIMIT_PURGE_AGE_MS,
} from "./auth-housekeeping";

vi.mock("@/db", async (importOriginal) =>
  (await import("@/__tests__/support/snapshot")).snapshotDbModule(
    await importOriginal<typeof import("@/db")>(),
  ),
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

// The purges are app-wide: each runs in a rolled-back snapshot with a 2001
// clock, on rows created inside it, so only this test's rows are old enough.
const NOW = new Date("2001-03-10T12:00:00.000Z");
const at = (ms: number) => new Date(NOW.getTime() + ms);
const MINUTE = 60 * 1000;

describe("purgeExpiredSessions", () => {
  test("an expired session goes, a live one stays", async () => {
    const { userId } = { userId: (await scope.createTestUser()).id };
    const result = await inOneSnapshot(async () => {
      const session = (expiresAt: Date) =>
        db.session.create({
          data: { id: randomUUID(), token: randomUUID(), userId, expiresAt },
          select: { id: true },
        });
      const expired = await session(at(-MINUTE));
      const live = await session(at(MINUTE));
      const count = await purgeExpiredSessions(NOW);
      const left = await db.session.findMany({
        where: { id: { in: [expired.id, live.id] } },
        select: { id: true },
      });
      return { count, left: left.map(({ id }) => id), live: live.id };
    });
    expect(result.count).toBe(1);
    expect(result.left).toEqual([result.live]);
  });
});

describe("purgeExpiredVerifications", () => {
  test("an expired row goes, a live one stays", async () => {
    const result = await inOneSnapshot(async () => {
      const verification = (expiresAt: Date) =>
        db.verification.create({
          data: {
            id: randomUUID(),
            identifier: `${scope.email()}`,
            value: "v",
            expiresAt,
          },
          select: { id: true },
        });
      const expired = await verification(at(-MINUTE));
      const live = await verification(at(MINUTE));
      const count = await purgeExpiredVerifications(NOW);
      const left = await db.verification.findMany({
        where: { id: { in: [expired.id, live.id] } },
        select: { id: true },
      });
      return { count, left: left.map(({ id }) => id), live: live.id };
    });
    expect(result.count).toBe(1);
    expect(result.left).toEqual([result.live]);
  });
});

describe("purgeStaleRateLimits", () => {
  test("a row older than 24 hours goes, a recent one stays", async () => {
    const ip = scope.ip();
    const result = await inOneSnapshot(async () => {
      const row = (key: string, lastRequest: Date) =>
        db.rateLimit.create({
          data: {
            id: randomUUID(),
            key: `${ip}|${key}`,
            count: 1,
            lastRequest: BigInt(lastRequest.getTime()),
          },
          select: { key: true },
        });
      await row("stale", at(-RATE_LIMIT_PURGE_AGE_MS - MINUTE));
      await row("recent", at(-RATE_LIMIT_PURGE_AGE_MS + MINUTE));
      const count = await purgeStaleRateLimits(NOW);
      return { count, left: (await scope.rateLimitRows()).map((r) => r.key) };
    });
    expect(result.count).toBe(1);
    expect(result.left).toEqual([`${ip}|recent`]);
  });
});
