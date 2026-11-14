import {
  assertMigrated,
  createTestScope,
  signInForCookie,
  type ResetGrantState,
} from "@/__tests__/support/test-db";
import { db } from "@/db";
import { setCredentialPassword } from "@/db/credentials";
import { changeMemberRole } from "@/data/members";
import { createLinkToken, hashLinkToken } from "@/lib/auth/link-tokens";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import {
  insertResetGrant,
  purgeExpiredResetGrants,
  resetPasswordThroughGrant,
} from "./reset-grants";

vi.mock("@/db", async (importOriginal) =>
  (await import("@/__tests__/support/snapshot")).snapshotDbModule(
    await importOriginal<typeof import("@/db")>(),
  ),
);

// Spied, not replaced: every call still sets the real password unless a test
// overrides one call.
vi.mock("@/db/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/credentials")>();
  return {
    ...actual,
    setCredentialPassword: vi.fn(actual.setCredentialPassword),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const HOUR_MS = 60 * 60 * 1000;
const NEW_PASSWORD = "a-brand-new-password";

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

const grantsOf = (userId: string) =>
  db.passwordResetGrant.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
const grantRow = (id: string) =>
  db.passwordResetGrant.findUniqueOrThrow({ where: { id } });
const passwordHashOf = async (userId: string) =>
  (
    await db.account.findFirstOrThrow({
      where: { userId, providerId: "credential" },
    })
  ).password;

// Signs in for real: proves which password the stored hash accepts.
async function signsInWith(email: string, password: string): Promise<boolean> {
  return signInForCookie({ email, password, ip: scope.ip() }).then(
    () => true,
    () => false,
  );
}

// Holds a user row so the calls started meanwhile all queue behind it.
function holdUserRow(userId: string) {
  let rowHeld!: () => void;
  const held = new Promise<void>((resolve) => (rowHeld = resolve));
  const done = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
      rowHeld();
      await tx.$executeRaw`SELECT pg_sleep(2)`;
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
  return { held, done };
}

// The same for a grant row (the reset claim's row lock).
function holdGrantRow(id: string) {
  let rowHeld!: () => void;
  const held = new Promise<void>((resolve) => (rowHeld = resolve));
  const done = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM password_reset_grant WHERE id = ${id} FOR UPDATE`;
      rowHeld();
      await tx.$executeRaw`SELECT pg_sleep(2)`;
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
  return { held, done };
}

describe("insertResetGrant", () => {
  test("writes the hash, both people and a 1-hour expiry from one instant", async () => {
    const organizer = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser({ name: "Mira K." });
    const { tokenHash } = createLinkToken();

    expect(
      await insertResetGrant({
        userId: member.id,
        createdById: organizer.id,
        tokenHash,
      }),
    ).toEqual({ kind: "created", displayName: "Mira K." });

    const [grant] = await grantsOf(member.id);
    expect(grant).toMatchObject({
      tokenHash,
      userId: member.id,
      createdById: organizer.id,
      usedAt: null,
    });
    expect(grant.expiresAt.getTime() - grant.createdAt.getTime()).toBe(HOUR_MS);
  });

  test("voids every earlier open grant at the new grant's instant; used ones keep their time", async () => {
    const organizer = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser();
    const open = await scope.createResetGrant({ userId: member.id });
    const used = await scope.createResetGrant({
      userId: member.id,
      state: "used",
    });
    const usedBefore = await grantRow(used.id);
    const { tokenHash } = createLinkToken();

    await insertResetGrant({
      userId: member.id,
      createdById: organizer.id,
      tokenHash,
    });

    const created = await db.passwordResetGrant.findUniqueOrThrow({
      where: { tokenHash },
    });
    expect((await grantRow(open.id)).usedAt).toEqual(created.createdAt);
    expect(await grantRow(used.id)).toEqual(usedBefore);
    expect(
      (await grantsOf(member.id)).filter((grant) => grant.usedAt === null),
    ).toHaveLength(1);
  });

  test("a suspended member gets a grant too", async () => {
    const organizer = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser({ status: "suspended" });
    const outcome = await insertResetGrant({
      userId: member.id,
      createdById: organizer.id,
      tokenHash: createLinkToken().tokenHash,
    });
    expect(outcome.kind).toBe("created");
  });

  test("an unknown member is memberGone and nothing is written", async () => {
    const organizer = await scope.createTestUser({ role: "organizer" });
    const { tokenHash } = createLinkToken();
    expect(
      await insertResetGrant({
        userId: "no-such-member",
        createdById: organizer.id,
        tokenHash,
      }),
    ).toEqual({ kind: "memberGone" });
    expect(await db.passwordResetGrant.count({ where: { tokenHash } })).toBe(0);
  });

  // The actor is re-checked under the organizer locks, as in changeMemberRole.
  test.each(["member", "suspended organizer"])(
    "an actor who is now a %s is actorGone and nothing is written",
    async (now) => {
      const actor = await scope.createTestUser(
        now === "member"
          ? { role: "member" }
          : { role: "organizer", status: "suspended" },
      );
      const member = await scope.createTestUser();
      const { tokenHash } = createLinkToken();

      expect(
        await insertResetGrant({
          userId: member.id,
          createdById: actor.id,
          tokenHash,
        }),
      ).toEqual({ kind: "actorGone" });
      expect(await grantsOf(member.id)).toEqual([]);
    },
  );

  // The member row lock: both creates queue behind the held row, then the
  // second voids the first's grant after it commits.
  test("two creates for one member at once leave exactly one open grant", async () => {
    const organizer = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser();
    const { held, done } = holdUserRow(member.id);
    await held;

    await Promise.all(
      [0, 1].map(() =>
        insertResetGrant({
          userId: member.id,
          createdById: organizer.id,
          tokenHash: createLinkToken().tokenHash,
        }),
      ),
    );
    await done;

    const grants = await grantsOf(member.id);
    expect(grants).toHaveLength(2);
    expect(grants.filter((grant) => grant.usedAt === null)).toHaveLength(1);
  });

  // A promote locks every active organizer, then its target; the grant insert
  // needs a key-share lock on its creator. Taking the organizer locks first
  // keeps one order, so the two queue instead of deadlocking.
  test("a reset link and a promote for one member at once both succeed", async () => {
    const creator = await scope.createTestUser({ role: "organizer" });
    const promoter = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser();
    const { held, done } = holdUserRow(member.id);
    await held;

    const create = insertResetGrant({
      userId: member.id,
      createdById: creator.id,
      tokenHash: createLinkToken().tokenHash,
    });
    // The create queues first; the promote then takes the organizer locks.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const promote = changeMemberRole({
      actorId: promoter.id,
      memberId: member.id,
      to: "organizer",
    });
    const outcomes = await Promise.allSettled([create, promote]);
    await done;

    expect(outcomes).toEqual([
      {
        status: "fulfilled",
        value: { kind: "created", displayName: "Mira K." },
      },
      { status: "fulfilled", value: "changed" },
    ]);
  });
});

describe("resetPasswordThroughGrant", () => {
  test("sets the new password, uses the grant and deletes every session", async () => {
    const member = await scope.createTestUser();
    await signInForCookie({ ...member, ip: scope.ip() });
    await signInForCookie({ ...member, ip: scope.ip() });
    expect(await scope.sessionsOf(member.id)).toHaveLength(2);
    const { id, token } = await scope.createResetGrant({ userId: member.id });

    expect(
      await resetPasswordThroughGrant({
        tokenHash: hashLinkToken(token),
        password: NEW_PASSWORD,
      }),
    ).toEqual({ kind: "reset", userId: member.id });

    expect((await grantRow(id)).usedAt).not.toBeNull();
    expect(await scope.sessionsOf(member.id)).toEqual([]);
    expect(await signsInWith(member.email, member.password)).toBe(false);
    expect(await signsInWith(member.email, NEW_PASSWORD)).toBe(true);
  });

  test.each<ResetGrantState | "unknown">([
    "unknown",
    "used",
    "superseded",
    "expired",
  ])(
    "an %s grant refuses before any password is hashed; nothing changes",
    async (state) => {
      const member = await scope.createTestUser();
      await signInForCookie({ ...member, ip: scope.ip() });
      const token =
        state === "unknown"
          ? createLinkToken().token
          : (await scope.createResetGrant({ userId: member.id, state })).token;
      const hashBefore = await passwordHashOf(member.id);
      const grantsBefore = await grantsOf(member.id);
      vi.mocked(setCredentialPassword).mockClear();

      expect(
        await resetPasswordThroughGrant({
          tokenHash: hashLinkToken(token),
          password: NEW_PASSWORD,
        }),
      ).toEqual({ kind: "invalidToken" });

      expect(setCredentialPassword).not.toHaveBeenCalled();
      expect(await passwordHashOf(member.id)).toBe(hashBefore);
      expect(await grantsOf(member.id)).toEqual(grantsBefore);
      expect(await scope.sessionsOf(member.id)).toHaveLength(1);
    },
  );

  // The concurrent-reset test: the claim serialises two resets on the grant
  // row's lock; the second matches nothing.
  test("two resets on one link at once: exactly one password is set", async () => {
    const member = await scope.createTestUser();
    const { id, token } = await scope.createResetGrant({ userId: member.id });
    const passwords = ["first-new-password", "second-new-password"];
    // Held by a third transaction, so both resets are in flight together.
    const { held, done } = holdGrantRow(id);
    await held;

    const outcomes = await Promise.all(
      passwords.map((password) =>
        resetPasswordThroughGrant({
          tokenHash: hashLinkToken(token),
          password,
        }),
      ),
    );
    await done;

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual([
      "invalidToken",
      "reset",
    ]);
    const winner = passwords[outcomes.findIndex((o) => o.kind === "reset")];
    const loser = passwords.find((password) => password !== winner)!;
    expect(await signsInWith(member.email, winner)).toBe(true);
    expect(await signsInWith(member.email, loser)).toBe(false);
  });

  test("a failure after the claim rolls everything back: the link still works, sessions stay", async () => {
    const member = await scope.createTestUser();
    await signInForCookie({ ...member, ip: scope.ip() });
    const { id, token } = await scope.createResetGrant({ userId: member.id });
    const hashBefore = await passwordHashOf(member.id);
    const failure = new Error("hasher down");
    vi.mocked(setCredentialPassword).mockRejectedValueOnce(failure);

    await expect(
      resetPasswordThroughGrant({
        tokenHash: hashLinkToken(token),
        password: NEW_PASSWORD,
      }),
    ).rejects.toBe(failure);

    expect((await grantRow(id)).usedAt).toBeNull();
    expect(await passwordHashOf(member.id)).toBe(hashBefore);
    expect(await scope.sessionsOf(member.id)).toHaveLength(1);
    const retry = await resetPasswordThroughGrant({
      tokenHash: hashLinkToken(token),
      password: NEW_PASSWORD,
    });
    expect(retry.kind).toBe("reset");
  });
});

// The daily job's purge is app-wide: a rolled-back snapshot with a 2001 clock,
// on grants created inside it (one-hour lifetime from `createdAt`).
describe("purgeExpiredResetGrants", () => {
  const NOW = new Date("2001-03-10T12:00:00.000Z");
  const EXPIRED = new Date(NOW.getTime() - 2 * HOUR_MS);
  const UNEXPIRED = new Date(NOW.getTime() - HOUR_MS / 2);

  test("removes every expired grant, used, superseded or open, and keeps an unexpired one", async () => {
    const userId = (await scope.createTestUser()).id;
    const result = await inOneSnapshot(async () => {
      const grant = async (state: ResetGrantState, createdAt: Date) =>
        (await scope.createResetGrant({ userId, state, createdAt })).id;
      const gone = [
        await grant("used", EXPIRED),
        await grant("superseded", EXPIRED),
        await grant("open", EXPIRED),
      ];
      const kept = await grant("open", UNEXPIRED);
      const count = await purgeExpiredResetGrants(NOW);
      const left = await db.passwordResetGrant.findMany({
        where: { id: { in: [...gone, kept] } },
        select: { id: true },
      });
      return { count, kept, left: left.map(({ id }) => id) };
    });
    expect(result.count).toBe(3);
    expect(result.left).toEqual([result.kept]);
  });
});
