import { randomBytes } from "node:crypto";
import { parseSetCookieHeader } from "better-auth/cookies";
import { db } from "@/db";
import { lockActiveOrganizerIds } from "@/data/members";
import { createCredentialUser } from "@/db/credentials";
import type { MemberStatus, Role } from "@/generated/prisma/client";
import { auth } from "@/lib/auth/auth";
import { categoryNameKey } from "@/lib/categories/name";
import { createLinkToken } from "@/lib/auth/link-tokens";
import { env } from "@/lib/env/server";

// Database tests share the dev/test Neon project with seed data and with
// other test files running in parallel. A file only ever touches rows it
// created: its tagged users (sessions and accounts cascade) and the
// rateLimit keys of its own addresses. Never reset, drop or truncate here.

export const SESSION_COOKIE = "better-auth.session_token";
export const TEST_PASSWORD = "correct-horse-battery";

const REQUIRED_MIGRATIONS = [
  "auth",
  "invitations",
  "password_reset_grants",
  "categories",
];

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

// Superseded is stored exactly like used: `usedAt` set by the next grant.
export type ResetGrantState = "open" | "used" | "superseded" | "expired";

type TestResetGrantOptions = {
  userId: string;
  state?: ResetGrantState;
  createdById?: string | null;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

    // A reset grant for one of this scope's users (it cascades with them); the
    // raw token is returned, the row holds its hash.
    async createResetGrant({
      userId,
      state = "open",
      createdById = null,
    }: TestResetGrantOptions): Promise<{ id: string; token: string }> {
      const { token, tokenHash } = createLinkToken();
      const now = Date.now();
      const created = new Date(state === "expired" ? now - 2 * HOUR_MS : now);
      const { id } = await db.passwordResetGrant.create({
        data: {
          userId,
          tokenHash,
          createdById,
          createdAt: created,
          expiresAt: new Date(created.getTime() + HOUR_MS),
          usedAt:
            state === "used" || state === "superseded" ? new Date(now) : null,
        },
        select: { id: true },
      });
      return { id, token };
    },

    // A category whose name starts with the scope's tag (2–30 characters with it),
    // so cleanup finds it however it was created.
    async createCategory(
      label = "Ladders",
    ): Promise<{ id: string; name: string }> {
      const name = `${tag} ${label}`;
      return db.category.create({
        data: { name, nameKey: categoryNameKey(name) },
        select: { id: true, name: true },
      });
    },
    categoryName: (label: string) => `${tag} ${label}`,

    // Rows belonging to this scope only: never global counts.
    sessionsOf: (userId: string) => db.session.findMany({ where: { userId } }),
    rateLimitRows: () =>
      db.rateLimit.findMany({
        where: { OR: ips.map((ip) => ({ key: { startsWith: `${ip}|` } })) },
      }),

    async cleanup() {
      await db.category.deleteMany({
        where: { nameKey: { startsWith: `${tag} ` } },
      });
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
      // A role change in another file locks every active organizer in id order,
      // then its target: deleting several users in scan order could deadlock
      // with it. Take the organizer locks first, then this scope's rows in id
      // order, as every organizer guard does.
      await db.$transaction(
        async (tx) => {
          await lockActiveOrganizerIds(tx);
          const own = await tx.user.findMany({
            where: users,
            select: { id: true },
            orderBy: { id: "asc" },
          });
          const ids = own.map(({ id }) => id);
          await tx.$queryRaw`
            SELECT id FROM "user" WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
          await tx.user.deleteMany({ where: { id: { in: ids } } });
        },
        { maxWait: 15_000, timeout: 30_000 },
      );
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
