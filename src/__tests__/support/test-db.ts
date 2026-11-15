import { randomBytes } from "node:crypto";
import { parseSetCookieHeader } from "better-auth/cookies";
import sharp from "sharp";
import { db } from "@/db";
import { lockActiveOrganizerIds } from "@/data/organizer-locks";
import { createCredentialUser } from "@/db/credentials";
import { toDbDate } from "@/data/db-dates";
import type {
  ItemStatus,
  LoanStatus,
  MemberStatus,
  Prisma,
  Role,
} from "@/generated/prisma/client";
import { auth } from "@/lib/auth/auth";
import { categoryNameKey } from "@/lib/categories/name";
import { createLinkToken } from "@/lib/auth/link-tokens";
import { env } from "@/lib/env/server";
import {
  createDiskStorage,
  DISK_URL_PREFIX,
  diskStorageRoot,
} from "@/lib/storage/disk";
import { newPhotoKey } from "@/lib/storage/keys";
import { REQUIRED_MIGRATIONS } from "@/__tests__/support/required-migrations";

// The app's disk driver (`.env.test` sets STORAGE_DRIVER=disk) at its root.
const testPhotoStorage = createDiskStorage({
  root: diskStorageRoot(),
  urlPrefix: DISK_URL_PREFIX,
});

// Database tests share the dev/test Neon project with seed data and with
// other test files running in parallel. A file only ever touches rows it
// created: its tagged users (sessions and accounts cascade) and the
// rateLimit keys of its own addresses. Never reset, drop or truncate here.

export const SESSION_COOKIE = "better-auth.session_token";
export const TEST_PASSWORD = "correct-horse-battery";

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
  contactDetails?: string | null;
};

export type StoredPhotoColumns = {
  photoKey: string;
  photoUrl: string;
  photoWidth: number;
  photoHeight: number;
  photoBytes: number;
};

type TestItemOptions = {
  ownerId: string | null;
  categoryId?: string;
  status?: ItemStatus;
  title?: string;
  maxLoanDays?: number;
  // `true`: placeholder columns with no file behind them; or a stored photo's.
  photo?: boolean | StoredPhotoColumns;
  createdAt?: Date;
  retiredAt?: Date;
};

// Loan dates are YYYY-MM-DD strings, as everywhere else.
type TestLoanOptions = {
  itemId: string;
  borrowerId: string | null;
  status: LoanStatus;
  startDate: string;
  endDate: string;
  returnedOn?: string | null;
} & Partial<
  Omit<
    Prisma.LoanUncheckedCreateInput,
    "itemId" | "borrowerId" | "status" | "startDate" | "endDate" | "returnedOn"
  >
>;

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
  createdAt?: Date;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// One per test file: a run-unique tag, the users it made and the addresses it used.
export function createTestScope() {
  const tag = `t${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
  const userIds: string[] = [];
  const invitationIds: string[] = [];
  const itemIds: string[] = [];
  const loanIds: string[] = [];
  const photoKeys: string[] = [];
  const ips: string[] = [];
  let count = 0;
  let defaultCategoryId: Promise<string> | undefined;

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
      contactDetails = null,
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
      if (contactDetails !== null) {
        await db.user.update({ where: { id }, data: { contactDetails } });
      }
      return { id, email, password };
    },

    // Inserted directly (no item action yet): Hidden, no photo, in a scope category.
    async createItem({
      ownerId,
      categoryId,
      status = "hidden",
      title = "Ladder",
      maxLoanDays = 7,
      photo = false,
      createdAt,
      retiredAt,
    }: TestItemOptions): Promise<{ id: string }> {
      defaultCategoryId ??= this.createCategory("Things").then(({ id }) => id);
      const now = new Date();
      const { id } = await db.item.create({
        data: {
          ownerId,
          categoryId: categoryId ?? (await defaultCategoryId),
          title,
          description: "",
          condition: "good",
          maxLoanDays,
          status,
          listedAt: status === "listed" ? now : null,
          retiredAt: status === "retired" ? (retiredAt ?? now) : null,
          ...(createdAt && { createdAt }),
          ...(typeof photo === "object" && photo),
          ...(photo === true && {
            photoKey: `${tag}/${randomBytes(4).toString("hex")}.webp`,
            photoUrl: `https://example.test/${tag}.webp`,
            photoWidth: 1200,
            photoHeight: 900,
            photoBytes: 120_000,
          }),
        },
        select: { id: true },
      });
      itemIds.push(id);
      return { id };
    },

    // The only loan writer before spec 13: any stored status, columns per status.
    async createLoan({
      itemId,
      borrowerId,
      status,
      startDate,
      endDate,
      returnedOn,
      ...overrides
    }: TestLoanOptions): Promise<{ id: string }> {
      const returned = status === "returned";
      const { id } = await db.loan.create({
        data: {
          itemId,
          borrowerId,
          status,
          startDate: toDbDate(startDate),
          endDate: toDbDate(endDate),
          returnedOn:
            returnedOn === undefined
              ? returned
                ? toDbDate(endDate)
                : null
              : returnedOn && toDbDate(returnedOn),
          returnedAsLent: returned ? "yes" : null,
          endedBy:
            status === "declined"
              ? "owner"
              : status === "cancelled"
                ? "borrower"
                : null,
          ...overrides,
        },
        select: { id: true },
      });
      loanIds.push(id);
      return { id };
    },

    // A user created outside createTestUser (a script, a seeder) joins the cleanup.
    track: (userId: string) => {
      userIds.push(userId);
    },

    // An item created outside createItem (a seeder's ownerless item) joins the
    // cleanup with its loans.
    trackItem: (itemId: string) => {
      itemIds.push(itemId);
    },

    // A stored file whose queue row and disk file go with the cleanup.
    trackPhotoKey: (key: string) => {
      photoKeys.push(key);
    },

    // A real WebP through the disk driver: the five photo column values.
    async createStoredPhoto(): Promise<StoredPhotoColumns> {
      const bytes = await sharp({
        create: {
          width: 40,
          height: 30,
          channels: 3,
          background: { r: 120, g: 140, b: 130 },
        },
      })
        .webp()
        .toBuffer();
      const key = newPhotoKey();
      photoKeys.push(key);
      const { url } = await testPhotoStorage.put(key, bytes, "image/webp");
      return {
        photoKey: key,
        photoUrl: url,
        photoWidth: 40,
        photoHeight: 30,
        photoBytes: bytes.byteLength,
      };
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
      createdAt,
    }: TestResetGrantOptions): Promise<{ id: string; token: string }> {
      const { token, tokenHash } = createLinkToken();
      const now = Date.now();
      const created =
        createdAt ?? new Date(state === "expired" ? now - 2 * HOUR_MS : now);
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
      // Loan → Item and Item → Category are Restrict: loans, then items, then
      // categories. Tracked ids catch an item whose owner was deleted in a test.
      const items = { OR: [{ id: { in: itemIds } }, { owner: users }] };
      await db.loan.deleteMany({
        where: {
          OR: [{ id: { in: loanIds } }, { item: items }, { borrower: users }],
        },
      });
      await db.item.deleteMany({ where: items });
      await db.category.deleteMany({
        where: { nameKey: { startsWith: `${tag} ` } },
      });
      // Upload rows would outlive their users (SetNull); queue rows and files
      // are found by tracked key, never by listing storage.
      await db.uploadLog.deleteMany({ where: { user: users } });
      await db.pendingBlobDeletion.deleteMany({
        where: { storageKey: { in: photoKeys } },
      });
      for (const key of photoKeys) await testPhotoStorage.delete(key);
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
