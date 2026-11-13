import { isRedirectError } from "next/dist/client/components/redirect-error";
import { refresh } from "next/cache";
import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import {
  changeMemberRole,
  reinstateMemberAccount,
  suspendMemberAccount,
} from "@/data/members";
import { insertResetGrant } from "@/data/reset-grants";
import { db } from "@/db";
import type { MemberStatus, Role } from "@/generated/prisma/enums";
import { hashLinkToken } from "@/lib/auth/link-tokens";
import { addDays, communityToday } from "@/lib/dates/dates";
import { env } from "@/lib/env/server";
import { reportUnexpected } from "@/lib/feedback/report";
import type {
  MemberStatusState,
  ResetLinkState,
  RoleChangeState,
} from "@/types/members";
import {
  createResetLink,
  demoteMember,
  promoteMember,
  reinstateMember,
  suspendMember,
} from "./members";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/members")>();
  return {
    ...actual,
    changeMemberRole: vi.fn(actual.changeMemberRole),
    suspendMemberAccount: vi.fn(actual.suspendMemberAccount),
    reinstateMemberAccount: vi.fn(actual.reinstateMemberAccount),
  };
});
vi.mock("@/lib/feedback/report", () => ({ reportUnexpected: vi.fn() }));
vi.mock("@/data/reset-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/reset-grants")>();
  return { ...actual, insertResetGrant: vi.fn(actual.insertResetGrant) };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const HOUR_MS = 60 * 60 * 1000;
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const idleRole: RoleChangeState = {};
const idleReset: ResetLinkState = {};

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function idForm(id?: string): FormData {
  const data = new FormData();
  if (id !== undefined) data.set("id", id);
  return data;
}

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  const error = await thrownBy(promise);
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

// Signs a fresh user in and makes them the request's viewer.
async function actAs(role: Role) {
  const user = await scope.createTestUser({ role });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

const userRow = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
const grantsOf = (userId: string) =>
  db.passwordResetGrant.findMany({ where: { userId } });

describe("promoteMember / demoteMember", () => {
  test("promotes an active member: role written, refreshed, flash key returned", async () => {
    await actAs("organizer");
    const member = await scope.createTestUser();
    const before = await userRow(member.id);

    expect(await promoteMember(idleRole, idForm(member.id))).toEqual({
      flash: "memberPromoted",
    });

    const after = await userRow(member.id);
    expect({ ...after, updatedAt: before.updatedAt }).toEqual({
      ...before,
      role: "organizer",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("demotes another active organizer", async () => {
    await actAs("organizer");
    const organizer = await scope.createTestUser({ role: "organizer" });

    expect(await demoteMember(idleRole, idForm(organizer.id))).toEqual({
      flash: "memberDemoted",
    });
    expect(await userRow(organizer.id)).toMatchObject({
      role: "member",
      status: "active",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test.each<[string, typeof promoteMember, Role, MemberStatus]>([
    ["promote of an organizer", promoteMember, "organizer", "active"],
    ["demote of a member", demoteMember, "member", "active"],
    ["promote of a suspended member", promoteMember, "member", "suspended"],
    ["demote of a suspended organizer", demoteMember, "organizer", "suspended"],
  ])(
    "%s is stale: nothing written, no refresh",
    async (_label, action, role, status) => {
      await actAs("organizer");
      const target = await scope.createTestUser({ role, status });
      const before = await userRow(target.id);

      expect(await action(idleRole, idForm(target.id))).toEqual({
        formError: "stale",
      });
      expect(await userRow(target.id)).toEqual(before);
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["an unknown id", "no-such-member"],
    ["an empty id", ""],
    ["no id at all", undefined],
  ])("%s is stale", async (_label, id) => {
    await actAs("organizer");
    expect(await promoteMember(idleRole, idForm(id))).toEqual({
      formError: "stale",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test.each([promoteMember, demoteMember])(
    "your own id is refused before any database write",
    async (action) => {
      const viewer = await actAs("organizer");
      expect(await action(idleRole, idForm(viewer.id))).toEqual({
        formError: "self",
      });
      expect(changeMemberRole).not.toHaveBeenCalled();
      expect(await userRow(viewer.id)).toMatchObject({ role: "organizer" });
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("the last-organizer refusal is returned inline with no refresh", async () => {
    await actAs("organizer");
    const organizer = await scope.createTestUser({ role: "organizer" });
    vi.mocked(changeMemberRole).mockResolvedValueOnce("lastOrganizer");

    expect(await demoteMember(idleRole, idForm(organizer.id))).toEqual({
      formError: "lastOrganizer",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("an unexpected failure returns the notice and refreshes nothing", async () => {
    await actAs("organizer");
    const member = await scope.createTestUser();
    vi.mocked(changeMemberRole).mockRejectedValueOnce(new Error("down"));

    expect(await promoteMember(idleRole, idForm(member.id))).toEqual({
      formError: "unexpected",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("the acting organizer is the viewer, never a form field", async () => {
    const viewer = await actAs("organizer");
    const member = await scope.createTestUser();
    const data = idForm(member.id);
    data.set("actorId", "someone-else");
    data.set("role", "member");

    await promoteMember(idleRole, data);

    expect(changeMemberRole).toHaveBeenCalledWith({
      actorId: viewer.id,
      memberId: member.id,
      to: "organizer",
    });
  });

  test.each([promoteMember, demoteMember])(
    "a member gets not-found and no role changes",
    async (action) => {
      await actAs("member");
      const target = await scope.createTestUser({ role: "organizer" });
      const error = await thrownBy(action(idleRole, idForm(target.id)));
      expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
      expect(changeMemberRole).not.toHaveBeenCalled();
      expect(await userRow(target.id)).toMatchObject({ role: "organizer" });
    },
  );

  test.each([promoteMember, demoteMember])(
    "a guest is sent to /login",
    async (action) => {
      mockNextRequest({ ip: scope.ip() });
      expect(await redirectTarget(action(idleRole, idForm("x")))).toBe(
        "/login",
      );
      expect(changeMemberRole).not.toHaveBeenCalled();
    },
  );
});

describe("createResetLink", () => {
  test("returns the link once; the grant holds its hash, both people and a 1-hour expiry", async () => {
    const viewer = await actAs("organizer");
    const member = await scope.createTestUser({ name: "Mira K." });
    const earlier = await scope.createResetGrant({ userId: member.id });

    const state = await createResetLink(idleReset, idForm(member.id));

    const origin = new URL(env.APP_URL).origin;
    expect(state.created?.note).toBe("Mira K.");
    const match = new RegExp(`^${origin}/reset/([A-Za-z0-9_-]{43})$`).exec(
      state.created?.url ?? "",
    );
    expect(match).not.toBeNull();
    const token = match![1];

    const grant = await db.passwordResetGrant.findUniqueOrThrow({
      where: { tokenHash: hashLinkToken(token) },
    });
    expect(grant).toMatchObject({
      userId: member.id,
      createdById: viewer.id,
      usedAt: null,
    });
    expect(grant.expiresAt.getTime() - grant.createdAt.getTime()).toBe(HOUR_MS);
    expect(JSON.stringify(grant)).not.toContain(token);
    const voided = await db.passwordResetGrant.findUniqueOrThrow({
      where: { id: earlier.id },
    });
    expect(voided.usedAt).toEqual(grant.createdAt);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a suspended member gets a link too", async () => {
    await actAs("organizer");
    const member = await scope.createTestUser({ status: "suspended" });
    const state = await createResetLink(idleReset, idForm(member.id));
    expect(state.created).toBeDefined();
  });

  test("your own id is refused and nothing is written", async () => {
    const viewer = await actAs("organizer");
    expect(await createResetLink(idleReset, idForm(viewer.id))).toEqual({
      formError: "self",
    });
    expect(insertResetGrant).not.toHaveBeenCalled();
    expect(await grantsOf(viewer.id)).toEqual([]);
  });

  test.each([
    ["an unknown id", "no-such-member"],
    ["an empty id", ""],
    ["no id at all", undefined],
  ])("%s is stale and writes nothing", async (_label, id) => {
    const viewer = await actAs("organizer");
    expect(await createResetLink(idleReset, idForm(id))).toEqual({
      formError: "stale",
    });
    expect(
      await db.passwordResetGrant.count({ where: { createdById: viewer.id } }),
    ).toBe(0);
  });

  test("an unexpected failure returns the notice", async () => {
    await actAs("organizer");
    const member = await scope.createTestUser();
    vi.mocked(insertResetGrant).mockRejectedValueOnce(new Error("down"));
    expect(await createResetLink(idleReset, idForm(member.id))).toEqual({
      formError: "unexpected",
    });
  });

  test("a member gets not-found and no grant is written", async () => {
    await actAs("member");
    const target = await scope.createTestUser();
    const error = await thrownBy(createResetLink(idleReset, idForm(target.id)));
    expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
    expect(await grantsOf(target.id)).toEqual([]);
  });

  test("a guest is sent to /login", async () => {
    mockNextRequest({ ip: scope.ip() });
    expect(await redirectTarget(createResetLink(idleReset, idForm("x")))).toBe(
      "/login",
    );
    expect(insertResetGrant).not.toHaveBeenCalled();
  });
});

describe("suspendMember / reinstateMember", () => {
  const idle: MemberStatusState = {};

  test("suspends an active member: sessions gone, requests swept, refreshed, flash key returned", async () => {
    const viewer = await actAs("organizer");
    const member = await scope.createTestUser();
    await signInForCookie({ ...member, ip: scope.ip() });
    const owner = await scope.createTestUser();
    const { id: itemId } = await scope.createItem({
      ownerId: owner.id,
      status: "listed",
    });
    const today = communityToday();
    const { id: loanId } = await scope.createLoan({
      itemId,
      borrowerId: member.id,
      status: "requested",
      startDate: addDays(today, 2),
      endDate: addDays(today, 3),
    });

    expect(await suspendMember(idle, idForm(member.id))).toEqual({
      flash: "memberSuspended",
    });

    expect(suspendMemberAccount).toHaveBeenCalledWith({
      actorId: viewer.id,
      memberId: member.id,
      today,
    });
    expect(await userRow(member.id)).toMatchObject({
      status: "suspended",
      role: "member",
    });
    expect(await scope.sessionsOf(member.id)).toEqual([]);
    expect(
      await db.loan.findUniqueOrThrow({ where: { id: loanId } }),
    ).toMatchObject({
      status: "cancelled",
      systemReason: "borrower_suspended",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("reinstates a suspended member: status only, refreshed, flash key returned", async () => {
    const viewer = await actAs("organizer");
    const member = await scope.createTestUser({ status: "suspended" });
    const before = await userRow(member.id);

    expect(await reinstateMember(idle, idForm(member.id))).toEqual({
      flash: "memberReinstated",
    });

    expect(reinstateMemberAccount).toHaveBeenCalledWith({
      actorId: viewer.id,
      memberId: member.id,
    });
    const after = await userRow(member.id);
    expect({ ...after, updatedAt: before.updatedAt }).toEqual({
      ...before,
      status: "active",
    });
    expect(await scope.sessionsOf(member.id)).toEqual([]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test.each<[string, typeof suspendMember, MemberStatus]>([
    ["suspend of a suspended member", suspendMember, "suspended"],
    ["reinstate of an active member", reinstateMember, "active"],
  ])(
    "%s is stale: nothing written, no refresh",
    async (_label, action, status) => {
      await actAs("organizer");
      const target = await scope.createTestUser({ status });
      const before = await userRow(target.id);

      expect(await action(idle, idForm(target.id))).toEqual({
        formError: "stale",
      });
      expect(await userRow(target.id)).toEqual(before);
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["an unknown id", "no-such-member"],
    ["an empty id", ""],
    ["no id at all", undefined],
  ])("%s is stale for both", async (_label, id) => {
    await actAs("organizer");
    expect(await suspendMember(idle, idForm(id))).toEqual({
      formError: "stale",
    });
    expect(await reinstateMember(idle, idForm(id))).toEqual({
      formError: "stale",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test.each([suspendMember, reinstateMember])(
    "your own id is refused before any database read",
    async (action) => {
      const viewer = await actAs("organizer");
      expect(await action(idle, idForm(viewer.id))).toEqual({
        formError: "self",
      });
      expect(suspendMemberAccount).not.toHaveBeenCalled();
      expect(reinstateMemberAccount).not.toHaveBeenCalled();
      expect(await userRow(viewer.id)).toMatchObject({ status: "active" });
      expect(await scope.sessionsOf(viewer.id)).not.toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("the last-organizer refusal is returned inline with no refresh", async () => {
    await actAs("organizer");
    const organizer = await scope.createTestUser({ role: "organizer" });
    vi.mocked(suspendMemberAccount).mockResolvedValueOnce("lastOrganizer");

    expect(await suspendMember(idle, idForm(organizer.id))).toEqual({
      formError: "lastOrganizer",
    });
    expect(await userRow(organizer.id)).toMatchObject({ status: "active" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test.each(["suspend", "reinstate"] as const)(
    "an unexpected %s failure is reported and returns the notice, no refresh",
    async (change) => {
      await actAs("organizer");
      const status = change === "suspend" ? "active" : "suspended";
      const action = change === "suspend" ? suspendMember : reinstateMember;
      const target = await scope.createTestUser({ status });
      const error = new Error("down");
      if (change === "suspend") {
        vi.mocked(suspendMemberAccount).mockRejectedValueOnce(error);
      } else {
        vi.mocked(reinstateMemberAccount).mockRejectedValueOnce(error);
      }

      expect(await action(idle, idForm(target.id))).toEqual({
        formError: "unexpected",
      });
      expect(reportUnexpected).toHaveBeenCalledWith("changeStatus", error);
      expect(await userRow(target.id)).toMatchObject({ status });
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test("the acting organizer is the viewer, never a form field", async () => {
    const viewer = await actAs("organizer");
    const member = await scope.createTestUser();
    const data = idForm(member.id);
    data.set("actorId", "someone-else");
    data.set("status", "active");
    data.set("today", "2020-01-01");

    await suspendMember(idle, data);

    expect(suspendMemberAccount).toHaveBeenCalledWith({
      actorId: viewer.id,
      memberId: member.id,
      today: communityToday(),
    });
  });

  test.each([suspendMember, reinstateMember])(
    "a member gets not-found and nothing changes",
    async (action) => {
      await actAs("member");
      const target = await scope.createTestUser();
      const error = await thrownBy(action(idle, idForm(target.id)));
      expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
      expect(suspendMemberAccount).not.toHaveBeenCalled();
      expect(reinstateMemberAccount).not.toHaveBeenCalled();
      expect(await userRow(target.id)).toMatchObject({ status: "active" });
    },
  );

  test.each([suspendMember, reinstateMember])(
    "a guest is sent to /login",
    async (action) => {
      mockNextRequest({ ip: scope.ip() });
      expect(await redirectTarget(action(idle, idForm("x")))).toBe("/login");
      expect(suspendMemberAccount).not.toHaveBeenCalled();
      expect(reinstateMemberAccount).not.toHaveBeenCalled();
    },
  );
});
