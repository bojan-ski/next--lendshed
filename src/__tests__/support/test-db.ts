import { randomBytes, randomUUID } from "node:crypto";
import { parseSetCookieHeader } from "better-auth/cookies";
import { hashPassword } from "better-auth/crypto";
import { db } from "@/db";
import type { MemberStatus, Role } from "@/generated/prisma/client";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";

// Database tests share the dev/test Neon project with seed data and with
// other test files running in parallel. A file only ever touches rows it
// created: its tagged users (sessions and accounts cascade) and the
// rateLimit keys of its own addresses. Never reset, drop or truncate here.

export const SESSION_COOKIE = "better-auth.session_token";
export const TEST_PASSWORD = "correct-horse-battery";

export async function assertMigrated(): Promise<void> {
  const failure = new Error(
    "The test database is missing the `auth` migration: run `npx prisma migrate deploy` against it.",
  );
  let applied: { count: bigint }[];
  try {
    applied = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) AS count FROM "_prisma_migrations"
      WHERE migration_name LIKE '%\_auth' AND finished_at IS NOT NULL`;
  } catch {
    throw failure;
  }
  if (Number(applied[0]?.count ?? 0) === 0) throw failure;
}

type TestUserOptions = {
  role?: Role;
  status?: MemberStatus;
  password?: string;
  name?: string;
};

export type TestUser = { id: string; email: string; password: string };

// One per test file: a run-unique tag, the users it made and the addresses it used.
export function createTestScope() {
  const tag = `t${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const userIds: string[] = [];
  const ips: string[] = [];
  let count = 0;

  return {
    tag,
    email: () => `${tag}-${++count}@test.invalid`,

    // A single valid address (the library ignores a list without trustedProxies).
    ip: () => {
      const ip = `10.${[...randomBytes(3)].join(".")}`;
      ips.push(ip);
      return ip;
    },

    async createTestUser({
      role = "member",
      status = "active",
      password = TEST_PASSWORD,
      name = "Mira K.",
    }: TestUserOptions = {}): Promise<TestUser> {
      const id = randomUUID();
      const email = this.email();
      userIds.push(id);
      await db.user.create({
        data: {
          id,
          name,
          email,
          role,
          status,
          accounts: {
            create: {
              id: randomUUID(),
              accountId: id,
              providerId: "credential",
              password: await hashPassword(password),
            },
          },
        },
      });
      return { id, email, password };
    },

    // Rows belonging to this scope only: never global counts.
    sessionsOf: (userId: string) => db.session.findMany({ where: { userId } }),
    rateLimitRows: () =>
      db.rateLimit.findMany({
        where: { OR: ips.map((ip) => ({ key: { startsWith: `${ip}|` } })) },
      }),

    async cleanup() {
      if (userIds.length > 0) {
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      }
      if (ips.length > 0) {
        await db.rateLimit.deleteMany({
          where: { OR: ips.map((ip) => ({ key: { startsWith: `${ip}|` } })) },
        });
      }
    },
  };
}

// A real session cookie value, obtained through the library's own handler.
export async function signInForCookie({
  email,
  password,
  ip,
}: {
  email: string;
  password: string;
  ip: string;
}): Promise<string> {
  const response = await auth.handler(
    new Request(new URL("/api/auth/sign-in/email", env.APP_URL), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: new URL(env.APP_URL).origin,
        "x-forwarded-for": ip,
      },
      body: JSON.stringify({ email, password }),
    }),
  );
  if (response.status !== 200) {
    throw new Error(`signInForCookie: sign-in answered ${response.status}`);
  }
  const header = response.headers.getSetCookie().join(", ");
  const value = parseSetCookieHeader(header).get(SESSION_COOKIE)?.value;
  if (!value) throw new Error("signInForCookie: no session cookie set");
  return value;
}
