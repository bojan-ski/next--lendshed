import { isRedirectError } from "next/dist/client/components/redirect-error";
import { mockNextRequest, readCookie } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
  type ResetGrantState,
} from "@/__tests__/support/test-db";
import { resetPasswordThroughGrant } from "@/data/reset-grants";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { createLinkToken } from "@/lib/auth/link-tokens";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
import { resetPassword } from "@/strings/resetPassword";
import type { ResetPasswordState } from "@/types/auth";
import { resetPasswordWithGrant } from "./reset";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/reset-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/reset-grants")>();
  return {
    ...actual,
    resetPasswordThroughGrant: vi.fn(actual.resetPasswordThroughGrant),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const NEW_PASSWORD = "a-brand-new-password";
const idle: ResetPasswordState = {};

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function resetForm(token: string, password = NEW_PASSWORD): FormData {
  const data = new FormData();
  data.set("token", token);
  data.set("password", password);
  return data;
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (thrown: unknown) => thrown,
  );
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

const grantRow = (id: string) =>
  db.passwordResetGrant.findUniqueOrThrow({ where: { id } });
const passwordHashOf = async (userId: string) =>
  (
    await db.account.findFirstOrThrow({
      where: { userId, providerId: "credential" },
    })
  ).password;

async function signsInWith(email: string, password: string): Promise<boolean> {
  return signInForCookie({ email, password, ip: scope.ip() }).then(
    () => true,
    () => false,
  );
}

describe("resetPasswordWithGrant", () => {
  test("sets the password, revokes every session, flashes and redirects to /login", async () => {
    const member = await scope.createTestUser();
    const cookies = [
      await signInForCookie({ ...member, ip: scope.ip() }),
      await signInForCookie({ ...member, ip: scope.ip() }),
    ];
    const { id, token } = await scope.createResetGrant({ userId: member.id });
    mockNextRequest({ ip: scope.ip() });

    expect(
      await redirectTarget(resetPasswordWithGrant(idle, resetForm(token))),
    ).toBe("/login");

    expect(readCookie(FLASH_COOKIE)).toBe("passwordReset");
    expect(readCookie(SESSION_COOKIE)).toBeUndefined();
    expect((await grantRow(id)).usedAt).not.toBeNull();
    expect(await scope.sessionsOf(member.id)).toEqual([]);
    for (const cookie of cookies) {
      mockNextRequest({
        ip: scope.ip(),
        cookies: { [SESSION_COOKIE]: cookie },
      });
      expect(await getViewer()).toBeNull();
    }
    expect(await signsInWith(member.email, member.password)).toBe(false);
    expect(await signsInWith(member.email, NEW_PASSWORD)).toBe(true);
  });

  test("another account signed in on this browser keeps its session", async () => {
    const member = await scope.createTestUser();
    const other = await scope.createTestUser();
    const ip = scope.ip();
    const otherCookie = await signInForCookie({ ...other, ip });
    const { token } = await scope.createResetGrant({ userId: member.id });
    mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: otherCookie } });

    await redirectTarget(resetPasswordWithGrant(idle, resetForm(token)));

    expect(await scope.sessionsOf(other.id)).toHaveLength(1);
    expect(await getViewer()).toMatchObject({ id: other.id });
  });

  test.each([
    ["too short", "abc"],
    ["not base64url", `${"a".repeat(42)}!`],
    ["empty", ""],
  ])(
    "a malformed token (%s) is a broken link with no database access",
    async (_label, token) => {
      mockNextRequest({ ip: scope.ip() });
      expect(await resetPasswordWithGrant(idle, resetForm(token))).toEqual({
        linkBroken: true,
      });
      expect(resetPasswordThroughGrant).not.toHaveBeenCalled();
    },
  );

  test("a malformed token wins over a bad password", async () => {
    mockNextRequest({ ip: scope.ip() });
    expect(
      await resetPasswordWithGrant(idle, resetForm("abc", "short")),
    ).toEqual({ linkBroken: true });
  });

  test.each<ResetGrantState | "unknown">([
    "unknown",
    "used",
    "superseded",
    "expired",
  ])(
    "an %s link gets exactly the broken-link state; nothing changes",
    async (state) => {
      const member = await scope.createTestUser();
      await signInForCookie({ ...member, ip: scope.ip() });
      const token =
        state === "unknown"
          ? createLinkToken().token
          : (await scope.createResetGrant({ userId: member.id, state })).token;
      const hashBefore = await passwordHashOf(member.id);
      mockNextRequest({ ip: scope.ip() });

      expect(await resetPasswordWithGrant(idle, resetForm(token))).toEqual({
        linkBroken: true,
      });
      expect(await passwordHashOf(member.id)).toBe(hashBefore);
      expect(await scope.sessionsOf(member.id)).toHaveLength(1);
      expect(readCookie(FLASH_COOKIE)).toBeUndefined();
    },
  );

  test.each([
    ["9 characters", "x".repeat(9), resetPassword.passwordTooShort],
    ["129 characters", "x".repeat(129), resetPassword.passwordTooLong],
  ])(
    "a password of %s is a field error; the link stays open and nothing is echoed",
    async (_label, password, message) => {
      const member = await scope.createTestUser();
      const { id, token } = await scope.createResetGrant({ userId: member.id });
      mockNextRequest({ ip: scope.ip() });

      const state = await resetPasswordWithGrant(
        idle,
        resetForm(token, password),
      );

      expect(state).toEqual({ fieldErrors: { password: [message] } });
      expect(JSON.stringify(state)).not.toContain(password);
      expect(JSON.stringify(state)).not.toContain(token);
      expect((await grantRow(id)).usedAt).toBeNull();
      expect(resetPasswordThroughGrant).not.toHaveBeenCalled();
    },
  );

  test("a missing password is a field error", async () => {
    mockNextRequest({ ip: scope.ip() });
    const data = new FormData();
    data.set("token", createLinkToken().token);
    const state = await resetPasswordWithGrant(idle, data);
    expect(Object.keys(state.fieldErrors ?? {})).toEqual(["password"]);
  });

  test("an unexpected failure is the notice; the link stays usable", async () => {
    const member = await scope.createTestUser();
    const { id, token } = await scope.createResetGrant({ userId: member.id });
    mockNextRequest({ ip: scope.ip() });
    vi.mocked(resetPasswordThroughGrant).mockRejectedValueOnce(
      new Error("down"),
    );

    expect(await resetPasswordWithGrant(idle, resetForm(token))).toEqual({
      formError: "unexpected",
    });
    expect((await grantRow(id)).usedAt).toBeNull();
    expect(readCookie(FLASH_COOKIE)).toBeUndefined();
  });
});
