import { isRedirectError } from "next/dist/client/components/redirect-error";
import { refresh } from "next/cache";
import {
  mockNextRequest,
  readCookie,
  readCookieOptions,
} from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
  type InvitationState,
} from "@/__tests__/support/test-db";
import { insertInvitation, joinThroughInvitation } from "@/data/invitations";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { auth } from "@/lib/auth/auth";
import { hashLinkToken } from "@/lib/auth/link-tokens";
import { env } from "@/lib/env/server";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
import { join } from "@/strings/join";
import type { JoinState } from "@/types/auth";
import type {
  InvitationFormState,
  RevokeInvitationState,
} from "@/types/invitation";
import {
  createInvitation,
  joinWithInvitation,
  revokeInvitation,
} from "./invitations";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/invitations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/invitations")>();
  return {
    ...actual,
    insertInvitation: vi.fn(actual.insertInvitation),
    joinThroughInvitation: vi.fn(actual.joinThroughInvitation),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const DAY_MS = 24 * 60 * 60 * 1000;
const PASSWORD = "correct-horse-battery";
const idleForm: InvitationFormState = {};
const idleRevoke: RevokeInvitationState = {};
const idleJoin: JoinState = {};

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
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

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

// Signs a fresh user in and makes them the request's viewer.
async function actAs(role: "member" | "organizer") {
  const user = await scope.createTestUser({ role });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

const invitationsBy = (createdById: string) =>
  db.invitation.findMany({ where: { createdById } });

const invitationRow = (id: string) =>
  db.invitation.findUniqueOrThrow({ where: { id } });

describe("createInvitation", () => {
  test("an organizer gets a one-time link whose hash is stored, expiring in 7 days", async () => {
    const organizer = await actAs("organizer");

    const state = await createInvitation(
      idleForm,
      form({ note: "  Mira, no. 14  " }),
    );

    const origin = new URL(env.APP_URL).origin;
    expect(state.created?.note).toBe("Mira, no. 14");
    const match = new RegExp(`^${origin}/invite/([A-Za-z0-9_-]{43})$`).exec(
      state.created?.url ?? "",
    );
    expect(match).not.toBeNull();
    const token = match![1];

    const rows = await invitationsBy(organizer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tokenHash: hashLinkToken(token),
      note: "Mira, no. 14",
      usedAt: null,
      revokedAt: null,
    });
    expect(rows[0].expiresAt.getTime() - rows[0].createdAt.getTime()).toBe(
      7 * DAY_MS,
    );
    expect(JSON.stringify(rows[0])).not.toContain(token);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test("an empty note is stored as null", async () => {
    const organizer = await actAs("organizer");
    const state = await createInvitation(idleForm, form({ note: "   " }));
    expect(state.created?.note).toBeNull();
    expect((await invitationsBy(organizer.id))[0].note).toBeNull();
  });

  test("a note of 81 characters is a field error and writes nothing", async () => {
    const organizer = await actAs("organizer");
    const state = await createInvitation(
      idleForm,
      form({ note: "x".repeat(81) }),
    );
    expect(Object.keys(state.fieldErrors ?? {})).toEqual(["note"]);
    expect(state.created).toBeUndefined();
    expect(await invitationsBy(organizer.id)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("an unexpected failure returns the notice and refreshes nothing", async () => {
    const organizer = await actAs("organizer");
    vi.mocked(insertInvitation).mockRejectedValueOnce(new Error("down"));
    const state = await createInvitation(idleForm, form({ note: "" }));
    expect(state).toEqual({ formError: "unexpected" });
    expect(await invitationsBy(organizer.id)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("an actor demoted or suspended since the guard is stale: no link, no refresh", async () => {
    await actAs("organizer");
    vi.mocked(insertInvitation).mockResolvedValueOnce("actorGone");
    expect(await createInvitation(idleForm, form({ note: "" }))).toEqual({
      formError: "stale",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a member gets not-found and writes nothing", async () => {
    const member = await actAs("member");
    const error = await thrownBy(createInvitation(idleForm, form({})));
    expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
    expect(await invitationsBy(member.id)).toEqual([]);
  });

  test("a guest is sent to /login", async () => {
    mockNextRequest({ ip: scope.ip() });
    expect(await redirectTarget(createInvitation(idleForm, form({})))).toBe(
      "/login",
    );
    expect(insertInvitation).not.toHaveBeenCalled();
  });
});

describe("revokeInvitation", () => {
  test("revokes an open invitation, refreshes and returns the flash key", async () => {
    await actAs("organizer");
    const { id } = await scope.createInvitation();

    expect(await revokeInvitation(idleRevoke, form({ id }))).toEqual({
      flash: "invitationRevoked",
    });
    expect((await invitationRow(id)).revokedAt).not.toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  test.each<InvitationState>(["used", "revoked", "expired"])(
    "a %s invitation is stale: nothing written, no refresh",
    async (state) => {
      await actAs("organizer");
      const { id } = await scope.createInvitation({ state });
      const before = await invitationRow(id);

      expect(await revokeInvitation(idleRevoke, form({ id }))).toEqual({
        formError: "stale",
      });
      expect(await invitationRow(id)).toEqual(before);
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["an unknown id", { id: crypto.randomUUID() }],
    ["no id", {}],
  ])("%s is stale", async (_label, fields) => {
    await actAs("organizer");
    expect(await revokeInvitation(idleRevoke, form(fields))).toEqual({
      formError: "stale",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a member gets not-found and the invitation stays open", async () => {
    await actAs("member");
    const { id } = await scope.createInvitation();
    const error = await thrownBy(revokeInvitation(idleRevoke, form({ id })));
    expect((error as { digest?: string }).digest).toBe(NOT_FOUND);
    expect((await invitationRow(id)).revokedAt).toBeNull();
  });

  test("a guest is sent to /login and the invitation stays open", async () => {
    mockNextRequest({ ip: scope.ip() });
    const { id } = await scope.createInvitation();
    expect(
      await redirectTarget(revokeInvitation(idleRevoke, form({ id }))),
    ).toBe("/login");
    expect((await invitationRow(id)).revokedAt).toBeNull();
  });
});

describe("joinWithInvitation", () => {
  function joinForm(token: string, overrides: Record<string, string> = {}) {
    return form({
      token,
      name: "Mira K.",
      email: scope.email(),
      password: PASSWORD,
      acceptHouseRules: "on",
      ...overrides,
    });
  }

  test("joins, signs the new member in and redirects to / with the joined flash", async () => {
    const { id, token } = await scope.createInvitation();
    const email = scope.email();
    mockNextRequest({ ip: scope.ip() });

    expect(
      await redirectTarget(
        joinWithInvitation(
          idleJoin,
          joinForm(token, { email: email.toUpperCase() }),
        ),
      ),
    ).toBe("/");

    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true },
    });
    expect(user).toMatchObject({ role: "member", status: "active" });
    expect(user.accounts).toHaveLength(1);
    expect(await invitationRow(id)).toMatchObject({ usedById: user.id });
    expect(readCookie(FLASH_COOKIE)).toBe("joined");
    expect(readCookie(SESSION_COOKIE)).toBeTruthy();
    expect(readCookieOptions(SESSION_COOKIE)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    // The bridged cookie round-trips: the next read finds the new member.
    expect(await getViewer()).toMatchObject({ id: user.id, role: "member" });
  });

  test.each([
    ["too short", "abc"],
    ["not base64url", `${"a".repeat(42)}!`],
    ["empty", ""],
  ])(
    "a malformed token (%s) is a broken link with no database access",
    async (_label, token) => {
      mockNextRequest({ ip: scope.ip() });
      expect(await joinWithInvitation(idleJoin, joinForm(token))).toEqual({
        linkBroken: true,
      });
      expect(joinThroughInvitation).not.toHaveBeenCalled();
    },
  );

  test.each<InvitationState | "unknown">([
    "unknown",
    "used",
    "revoked",
    "expired",
  ])(
    "an %s token gets exactly the broken-link state and no account",
    async (state) => {
      const token =
        state === "unknown"
          ? "A".repeat(43)
          : (await scope.createInvitation({ state })).token;
      const email = scope.email();
      mockNextRequest({ ip: scope.ip() });

      expect(
        await joinWithInvitation(idleJoin, joinForm(token, { email })),
      ).toEqual({ linkBroken: true });
      expect(await db.user.count({ where: { email } })).toBe(0);
    },
  );

  test.each<[string, Record<string, string>, string[]]>([
    ["a 1-character name", { name: "M" }, ["name"]],
    ["a 41-character name", { name: "M".repeat(41) }, ["name"]],
    ["a bad email", { email: "not-an-email" }, ["email"]],
    ["a 9-character password", { password: "123456789" }, ["password"]],
    ["unticked house rules", { acceptHouseRules: "" }, ["acceptHouseRules"]],
  ])(
    "%s is a field error that echoes name and email, never the password",
    async (_label, overrides, keys) => {
      const { id, token } = await scope.createInvitation();
      mockNextRequest({ ip: scope.ip() });
      const data = joinForm(token, overrides);
      if (overrides.acceptHouseRules === "") data.delete("acceptHouseRules");

      const state = await joinWithInvitation(idleJoin, data);

      const reported = Object.entries(state.fieldErrors ?? {})
        .filter(([, messages]) => messages?.length)
        .map(([key]) => key);
      expect(reported).toEqual(keys);
      expect(state.name).toBe(data.get("name"));
      expect(state.email).toBe(data.get("email"));
      expect(JSON.stringify(state)).not.toContain(String(data.get("password")));
      expect(joinThroughInvitation).not.toHaveBeenCalled();
      expect((await invitationRow(id)).usedAt).toBeNull();
    },
  );

  test("role, status, id and usedById sent with the form are ignored", async () => {
    const { id, token } = await scope.createInvitation();
    const email = scope.email();
    mockNextRequest({ ip: scope.ip() });

    expect(
      await redirectTarget(
        joinWithInvitation(
          idleJoin,
          joinForm(token, {
            email,
            role: "organizer",
            status: "suspended",
            id: "chosen-id",
            usedById: "someone-else",
          }),
        ),
      ),
    ).toBe("/");

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: "member", status: "active" });
    expect(user.id).not.toBe("chosen-id");
    expect(
      (await db.invitation.findUniqueOrThrow({ where: { id } })).usedById,
    ).toBe(user.id);
  });

  test("a duplicate email is a field error; the link stays usable for another email", async () => {
    const existing = await scope.createTestUser();
    const { id, token } = await scope.createInvitation();
    mockNextRequest({ ip: scope.ip() });

    const state = await joinWithInvitation(
      idleJoin,
      joinForm(token, { email: existing.email.toUpperCase() }),
    );
    expect(state.fieldErrors).toEqual({ email: [join.emailTaken] });
    expect(state.email).toBe(existing.email.toUpperCase());
    expect((await invitationRow(id)).usedAt).toBeNull();

    mockNextRequest({ ip: scope.ip() });
    expect(
      await redirectTarget(joinWithInvitation(idleJoin, joinForm(token))),
    ).toBe("/");
  });

  test("an unexpected failure is the notice, with name and email echoed", async () => {
    const { token } = await scope.createInvitation();
    mockNextRequest({ ip: scope.ip() });
    vi.mocked(joinThroughInvitation).mockRejectedValueOnce(new Error("down"));
    const data = joinForm(token);

    expect(await joinWithInvitation(idleJoin, data)).toEqual({
      formError: "unexpected",
      name: "Mira K.",
      email: data.get("email"),
    });
  });

  test("a refused sign-in after commit keeps the account and sends the member to /login", async () => {
    const { id, token } = await scope.createInvitation();
    const email = scope.email();
    mockNextRequest({ ip: scope.ip() });
    vi.spyOn(auth, "handler").mockResolvedValue(
      new Response(null, { status: 429 }),
    );

    expect(
      await redirectTarget(
        joinWithInvitation(idleJoin, joinForm(token, { email })),
      ),
    ).toBe("/login");

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect((await invitationRow(id)).usedById).toBe(user.id);
    expect(readCookie(FLASH_COOKIE)).toBe("joinedSignIn");
    expect(readCookie(SESSION_COOKIE)).toBeUndefined();
    expect(joinThroughInvitation).toHaveBeenCalledTimes(1);
  });
});
