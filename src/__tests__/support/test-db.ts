import { randomBytes } from "node:crypto";
import { parseSetCookieHeader } from "better-auth/cookies";
import { db } from "@/db";
import { createCredentialUser } from "@/db/credentials";
import type { MemberStatus, Role } from "@/generated/prisma/client";
import { auth } from "@/lib/auth/auth";
import { createLinkToken } from "@/lib/auth/link-tokens";
import { env } from "@/lib/env/server";

// Database tests share the dev/test Neon project with seed data and with
// other test files running in parallel. A file only ever touches rows it
// created: its tagged users (sessions and accounts cascade) and the
// rateLimit keys of its own addresses. Never reset, drop or truncate here.

export const SESSION_COOKIE = "better-auth.session_token";
export const TEST_PASSWORD = "correct-horse-battery";

const REQUIRED_MIGRATIONS = ["auth", "invitations"];

export async function assertMigrated(): Promise<void> {
  const failure = (name: string) =>
    new Error(
      `The test database is missing the \`${name}\` migration: run \`npx prisma migrate deploy\` against it.`,
    );
  let applied: { migration_name: string }[];
  try {
    applied = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM "_prisma_migrations"
      WHERE finished_at IS NOT NULL`;
  } catch {
    throw failure(REQUIRED_MIGRATIONS[0]);
  }
  for (const name of REQUIRED_MIGRATIONS) {
    if (!applied.some((row) => row.migration_name.endsWith(`_${name}`))) {
      throw failure(name);
    }
  }
}

type TestUserOptions = {
  role?: Role;
  status?: MemberStatus;
  password?: string;
  name?: string;
};

export type TestUser = { id: string; email: string; password: string };

export type InvitationState = "open" | "used" | "revoked" | "expired";

type TestInvitationOptions = {
  state?: InvitationState;
  note?: string | null;
  createdById?: string | null;
  createdAt?: Date;
};

const DAY_MS = 24 * 60 * 60 * 1000;

// One per test file: a run-unique tag, the users it made and the addresses it used.
export function createTestScope() {
  const tag = `t${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const userIds: string[] = [];
  const invitationIds: string[] = [];
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
      const email = this.email();
      const { id } = await createCredentialUser(db, {
        name,
        email,
        password,
        role,
        status,
      });
      userIds.push(id);
      return { id, email, password };
    },

    // A user created outside createTestUser (a script, a seeder) joins the cleanup.
    track: (userId: string) => {
      userIds.push(userId);
    },

    // An invitation in a chosen state; the raw token is returned, the row holds its hash.
    async createInvitation({
      state = "open",
      note = null,
      createdById = null,
      createdAt,
    }: TestInvitationOptions = {}): Promise<{ id: string; token: string }> {
      const { token, tokenHash } = createLinkToken();
      const now = Date.now();
      const created =
        createdAt ?? new Date(state === "expired" ? now - 8 * DAY_MS : now);
      const { id } = await db.invitation.create({
        data: {
          tokenHash,
          note,
          createdById,
          createdAt: created,
          expiresAt: new Date(created.getTime() + 7 * DAY_MS),
          usedAt: state === "used" ? new Date(now) : null,
          revokedAt: state === "revoked" ? new Date(now) : null,
        },
        select: { id: true },
      });
      invitationIds.push(id);
      return { id, token };
    },

    // Rows belonging to this scope only: never global counts.
    sessionsOf: (userId: string) => db.session.findMany({ where: { userId } }),
    rateLimitRows: () =>
      db.rateLimit.findMany({
        where: { OR: ips.map((ip) => ({ key: { startsWith: `${ip}|` } })) },
      }),

    async cleanup() {
      // Users made through a join carry the scope's email, not a tracked id.
      const users = {
        OR: [{ id: { in: userIds } }, { email: { startsWith: `${tag}-` } }],
      };
      await db.invitation.deleteMany({
        where: {
          OR: [
            { id: { in: invitationIds } },
            { createdBy: users },
            { usedBy: users },
          ],
        },
      });
      await db.user.deleteMany({ where: users });
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
