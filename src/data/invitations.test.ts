import { holdRow } from "@/__tests__/support/hold-row";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import {
  assertMigrated,
  createTestScope,
  type InvitationState,
} from "@/__tests__/support/test-db";
import { suspendMemberAccount } from "@/data/members";
import { db } from "@/db";
import { createCredentialUser } from "@/db/credentials";
import { Prisma } from "@/generated/prisma/client";
import { createLinkToken, hashLinkToken } from "@/lib/auth/link-tokens";
import { communityToday } from "@/lib/dates/dates";
import { people } from "@/strings/people";
import {
  getOpenInvitations,
  insertInvitation,
  joinThroughInvitation,
  purgeExpiredInvitations,
  revokeOpenInvitation,
} from "./invitations";

vi.mock("@/db", async (importOriginal) =>
  (await import("@/__tests__/support/snapshot")).snapshotDbModule(
    await importOriginal<typeof import("@/db")>(),
  ),
);

// Spied, not replaced: every call still creates the real user unless a test
// overrides one call.
vi.mock("@/db/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/credentials")>();
  return {
    ...actual,
    createCredentialUser: vi.fn(actual.createCredentialUser),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "correct-horse-battery";

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

function joinInput(token: string, email = scope.email()) {
  return {
    tokenHash: hashLinkToken(token),
    name: "Mira K.",
    email,
    password: PASSWORD,
  };
}

const invitationRow = (id: string) =>
  db.invitation.findUniqueOrThrow({ where: { id } });

// Holds an invitation row so the calls started meanwhile all queue behind it.
function holdInvitationRow(id: string) {
  let rowHeld!: () => void;
  const held = new Promise<void>((resolve) => (rowHeld = resolve));
  const done = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT id FROM invitation WHERE id = ${id} FOR UPDATE`;
      rowHeld();
      await tx.$executeRaw`SELECT pg_sleep(2)`;
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
  return { held, done };
}

describe("joinThroughInvitation", () => {
  test("joins: one member user with a credential account, invitation used by them", async () => {
    const { id, token } = await scope.createInvitation();
    const email = scope.email().toUpperCase();

    const outcome = await joinThroughInvitation(joinInput(token, email));

    expect(outcome.kind).toBe("joined");
    const userId = (outcome as { userId: string }).userId;
    const user = await db.user.findUniqueOrThrow({
      where: { id: userId },
      include: { accounts: true },
    });
    expect(user).toMatchObject({
      email: email.toLowerCase(),
      role: "member",
      status: "active",
    });
    expect(user.accounts.map((a) => a.providerId)).toEqual(["credential"]);
    const invitation = await invitationRow(id);
    expect(invitation.usedAt).not.toBeNull();
    expect(invitation.usedById).toBe(userId);
  });

  // The atomic-join test (OQ-32): the claim serialises two joins on the row lock.
  // A third transaction holds the row first, so both joins are in flight
  // together; unheld, they often run one after the other and a read-then-update
  // claim would pass too.
  test("two joins on one link at once: exactly one account", async () => {
    const { id, token } = await scope.createInvitation();
    const emails = [scope.email(), scope.email()];
    const { held, done } = holdInvitationRow(id);
    await held;

    const outcomes = await Promise.all(
      emails.map((email) => joinThroughInvitation(joinInput(token, email))),
    );
    await done;

    expect(outcomes.map((o) => o.kind).sort()).toEqual([
      "invalidToken",
      "joined",
    ]);
    const users = await db.user.findMany({ where: { email: { in: emails } } });
    expect(users).toHaveLength(1);
    const winner = outcomes.find((o) => o.kind === "joined") as {
      userId: string;
    };
    expect(users[0].id).toBe(winner.userId);
    expect((await invitationRow(id)).usedById).toBe(winner.userId);
  });

  test.each<InvitationState>(["used", "revoked", "expired"])(
    "a %s invitation refuses before any password is hashed",
    async (state) => {
      const { id, token } = await scope.createInvitation({ state });
      const before = await invitationRow(id);
      const email = scope.email();
      vi.mocked(createCredentialUser).mockClear();

      expect(await joinThroughInvitation(joinInput(token, email))).toEqual({
        kind: "invalidToken",
      });

      expect(createCredentialUser).not.toHaveBeenCalled();
      expect(await db.user.count({ where: { email } })).toBe(0);
      expect(await invitationRow(id)).toEqual(before);
    },
  );

  test("an unknown token refuses", async () => {
    const { token } = createLinkToken();
    expect(await joinThroughInvitation(joinInput(token))).toEqual({
      kind: "invalidToken",
    });
  });

  test("a duplicate email (any case) rolls the claim back; the link still works", async () => {
    const existing = await scope.createTestUser();
    const { id, token } = await scope.createInvitation();

    expect(
      await joinThroughInvitation(
        joinInput(token, existing.email.toUpperCase()),
      ),
    ).toEqual({ kind: "emailTaken" });
    const afterRefusal = await invitationRow(id);
    expect(afterRefusal.usedAt).toBeNull();
    expect(afterRefusal.usedById).toBeNull();

    const retry = await joinThroughInvitation(joinInput(token));
    expect(retry.kind).toBe("joined");
  });

  test("a P2002 on another constraint is not emailTaken, and rolls back", async () => {
    const { id, token } = await scope.createInvitation();
    const otherConstraint = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: Prisma.prismaVersion.client,
        meta: {
          modelName: "Account",
          driverAdapterError: {
            cause: { constraint: { index: "account_pkey" } },
          },
        },
      },
    );
    vi.mocked(createCredentialUser).mockRejectedValueOnce(otherConstraint);

    await expect(joinThroughInvitation(joinInput(token))).rejects.toBe(
      otherConstraint,
    );
    expect((await invitationRow(id)).usedAt).toBeNull();
  });
});

describe("insertInvitation", () => {
  test("writes the hash, the creator and a 7-day expiry from one instant", async () => {
    const creator = await scope.createTestUser({ role: "organizer" });
    const { tokenHash } = createLinkToken();

    await insertInvitation({
      tokenHash,
      note: "Mira, no. 14",
      createdById: creator.id,
    });

    const row = await db.invitation.findUniqueOrThrow({ where: { tokenHash } });
    expect(row).toMatchObject({
      note: "Mira, no. 14",
      createdById: creator.id,
      usedAt: null,
      revokedAt: null,
    });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(7 * DAY_MS);
  });

  test("an active organizer's create is created", async () => {
    const creator = await scope.createTestUser({ role: "organizer" });
    const { tokenHash } = createLinkToken();
    expect(
      await insertInvitation({
        tokenHash,
        note: null,
        createdById: creator.id,
      }),
    ).toBe("created");
  });

  test.each([
    ["demoted to member", "member", "active"],
    ["suspended", "organizer", "suspended"],
  ] as const)(
    "an actor %s since the guard is actorGone and nothing is written",
    async (_label, role, status) => {
      const creator = await scope.createTestUser({ role, status });
      const { tokenHash } = createLinkToken();

      expect(
        await insertInvitation({
          tokenHash,
          note: null,
          createdById: creator.id,
        }),
      ).toBe("actorGone");
      expect(
        await db.invitation.findUnique({ where: { tokenHash } }),
      ).toBeNull();
    },
  );

  // Both queue on the organizer locks behind a held row; whichever runs second
  // decides, and no open invitation by the suspended organizer remains.
  test.each(["create first", "suspend first"] as const)(
    "a create and its organizer's suspension at once, %s",
    async (order) => {
      const actor = await scope.createTestUser({ role: "organizer" });
      const creator = await scope.createTestUser({ role: "organizer" });
      const { tokenHash } = createLinkToken();
      const create = () =>
        insertInvitation({ tokenHash, note: null, createdById: creator.id });
      const suspend = () =>
        suspendMemberAccount({
          actorId: actor.id,
          memberId: creator.id,
          today: communityToday(),
        });

      const held = holdRow("user", creator.id);
      await held.held;
      const first = order === "create first" ? create() : suspend();
      await held.queued(1);
      const second = order === "create first" ? suspend() : create();
      await held.queued(2);
      held.release();
      await held.done;
      const outcomes = [await first, await second];

      const row = await db.invitation.findUnique({ where: { tokenHash } });
      if (order === "create first") {
        expect(outcomes).toEqual(["created", "suspended"]);
        expect(row?.revokedAt).not.toBeNull();
      } else {
        expect(outcomes).toEqual(["suspended", "actorGone"]);
        expect(row).toBeNull();
      }
      expect(
        await db.invitation.count({
          where: {
            createdById: creator.id,
            usedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
        }),
      ).toBe(0);
    },
  );
});

describe("revokeOpenInvitation", () => {
  test("revokes an open invitation", async () => {
    const { id } = await scope.createInvitation();
    expect(await revokeOpenInvitation(id)).toBe("revoked");
    expect((await invitationRow(id)).revokedAt).not.toBeNull();
  });

  test.each<InvitationState>(["used", "revoked", "expired"])(
    "a %s invitation is not open: nothing changes",
    async (state) => {
      const { id } = await scope.createInvitation({ state });
      const before = await invitationRow(id);
      expect(await revokeOpenInvitation(id)).toBe("notOpen");
      expect(await invitationRow(id)).toEqual(before);
    },
  );

  test("an unknown id is not open", async () => {
    expect(await revokeOpenInvitation(crypto.randomUUID())).toBe("notOpen");
  });

  // Both are conditional updates on the same row: held by a third transaction,
  // they queue, and the later one finds the link no longer open.
  test("a revoke and a join on one link at once: exactly one wins", async () => {
    const { id, token } = await scope.createInvitation();
    const email = scope.email();
    const { held, done } = holdInvitationRow(id);
    await held;

    const [revoked, joined] = await Promise.all([
      revokeOpenInvitation(id),
      joinThroughInvitation(joinInput(token, email)),
    ]);
    await done;

    const row = await invitationRow(id);
    const user = await db.user.findUnique({ where: { email } });
    if (revoked === "revoked") {
      expect(joined).toEqual({ kind: "invalidToken" });
      expect(user).toBeNull();
      expect(row).toMatchObject({ usedAt: null, usedById: null });
      expect(row.revokedAt).not.toBeNull();
    } else {
      expect(revoked).toBe("notOpen");
      expect(joined).toMatchObject({ kind: "joined" });
      expect(row.revokedAt).toBeNull();
      expect(row.usedById).toBe(user?.id);
    }
  });
});

describe("getOpenInvitations", () => {
  // The shared database holds other files' and the seed's invitations: assert
  // on this scope's rows only.
  test("lists only open invitations, newest first, as DTOs", async () => {
    const creator = await scope.createTestUser({ name: "Ada O." });
    const now = Date.now();
    const older = await scope.createInvitation({
      note: "older",
      createdById: creator.id,
      createdAt: new Date(now - 2 * DAY_MS),
    });
    const newer = await scope.createInvitation({
      createdById: null,
      createdAt: new Date(now - DAY_MS),
    });
    const closed = await Promise.all(
      (["used", "revoked", "expired"] as const).map((state) =>
        scope.createInvitation({ state, createdById: creator.id }),
      ),
    );
    const mine = new Set([older.id, newer.id, ...closed.map((c) => c.id)]);

    const rows = (await getOpenInvitations()).filter((row) => mine.has(row.id));

    expect(rows.map((row) => row.id)).toEqual([newer.id, older.id]);
    const olderRow = await invitationRow(older.id);
    expect(rows[1]).toEqual({
      id: older.id,
      note: "older",
      expiresAt: olderRow.expiresAt.toISOString(),
      createdByName: "Ada O.",
    });
    expect(rows[0]).toMatchObject({
      note: null,
      createdByName: people.formerMember,
    });
  });
});

// The daily job's purge is app-wide: a rolled-back snapshot with a 2001 clock,
// on invitations created inside it (7-day lifetime from `createdAt`).
describe("purgeExpiredInvitations", () => {
  const NOW = new Date("2001-03-10T12:00:00.000Z");
  const EXPIRED = new Date(NOW.getTime() - 8 * DAY_MS);
  const UNEXPIRED = new Date(NOW.getTime() - 6 * DAY_MS);

  test("removes unused expired invitations, revoked or open, and keeps the rest", async () => {
    const result = await inOneSnapshot(async () => {
      const ids = {
        usedExpired: (
          await scope.createInvitation({ state: "used", createdAt: EXPIRED })
        ).id,
        revokedUnexpired: (
          await scope.createInvitation({
            state: "revoked",
            createdAt: UNEXPIRED,
          })
        ).id,
        revokedExpired: (
          await scope.createInvitation({ state: "revoked", createdAt: EXPIRED })
        ).id,
        openExpired: (
          await scope.createInvitation({ state: "open", createdAt: EXPIRED })
        ).id,
      };
      const count = await purgeExpiredInvitations(NOW);
      const left = await db.invitation.findMany({
        where: { id: { in: Object.values(ids) } },
        select: { id: true },
      });
      return { ids, count, left: left.map(({ id }) => id).sort() };
    });
    expect(result.count).toBe(2);
    expect(result.left).toEqual(
      [result.ids.usedExpired, result.ids.revokedUnexpired].sort(),
    );
  });
});
