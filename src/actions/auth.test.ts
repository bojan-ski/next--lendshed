import { isRedirectError } from "next/dist/client/components/redirect-error";
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
} from "@/__tests__/support/test-db";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { auth } from "@/lib/auth/auth";
import { env } from "@/lib/env/server";
import type { SignInState } from "@/types/auth";
import { signIn, signOut } from "./auth";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();
const idle: SignInState = {};

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// The redirect target, read from the error redirect() throws.
async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected a redirect");
    },
    (thrown: unknown) => thrown,
  );
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

describe("signIn", () => {
  test.each([
    [{ email: "", password: "" }, ["email", "password"]],
    [{ email: "not-an-email", password: "x" }, ["email"]],
    [{ email: "mira@example.com", password: "" }, ["password"]],
  ])(
    "invalid input %o returns field errors for %o and never calls the library",
    async (fields, keys) => {
      mockNextRequest({ ip: scope.ip() });
      const handler = vi.spyOn(auth, "handler");
      const state = await signIn(idle, form(fields));
      const reported = Object.entries(state.fieldErrors ?? {})
        .filter(([, messages]) => messages?.length)
        .map(([key]) => key);
      expect(reported.sort()).toEqual(keys);
      expect(state.email).toBe(fields.email);
      expect(state.formError).toBeUndefined();
      expect(handler).not.toHaveBeenCalled();
    },
  );

  test("valid credentials set the session cookie and redirect to the validated next", async () => {
    const user = await scope.createTestUser();
    mockNextRequest({ ip: scope.ip(), userAgent: "Lendshed test agent" });

    const target = await redirectTarget(
      signIn(
        idle,
        form({
          email: user.email,
          password: user.password,
          next: "/items/a?b=1",
        }),
      ),
    );

    expect(target).toBe("/items/a?b=1");
    expect(readCookie(SESSION_COOKIE)).toBeTruthy();
    const sessions = await scope.sessionsOf(user.id);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].userAgent).toBe("Lendshed test agent");
    // The bridged cookie round-trips: the next read finds the session.
    expect(await getViewer()).toMatchObject({ id: user.id });
  });

  test("the session cookie keeps the library's attributes: httpOnly, lax, /, 30 days", async () => {
    const user = await scope.createTestUser();
    mockNextRequest({ ip: scope.ip() });
    await redirectTarget(
      signIn(idle, form({ email: user.email, password: user.password })),
    );

    expect(readCookieOptions(SESSION_COOKIE)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      // The library marks it Secure for an https base URL or in production.
      secure: new URL(env.APP_URL).protocol === "https:" || undefined,
    });
  });

  // The test APP_URL is http, so the real library sends no Secure; production does.
  test("copies Secure when the library sets it (https / production)", async () => {
    mockNextRequest({ ip: scope.ip() });
    vi.spyOn(auth, "handler").mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: {
          "set-cookie": `${SESSION_COOKIE}=token.sig; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax`,
        },
      }),
    );

    await redirectTarget(
      signIn(
        idle,
        form({ email: "mira@example.com", password: "whatever-10" }),
      ),
    );

    expect(readCookieOptions(SESSION_COOKIE)).toMatchObject({
      secure: true,
      httpOnly: true,
    });
  });

  test("signs in with a differently cased, padded email", async () => {
    const user = await scope.createTestUser();
    mockNextRequest({ ip: scope.ip() });
    const target = await redirectTarget(
      signIn(
        idle,
        form({
          email: `  ${user.email.toUpperCase()} `,
          password: user.password,
        }),
      ),
    );
    expect(target).toBe("/");
  });

  test.each([
    ["missing", undefined],
    ["protocol-relative", "//evil.com"],
    ["dot-segment protocol-relative", "/.//evil.com"],
    ["the login page", "/login"],
    ["absolute", "https://evil.com/"],
  ])("a %s next redirects to /", async (_case, next) => {
    const user = await scope.createTestUser();
    mockNextRequest({ ip: scope.ip() });
    const fields: Record<string, string> = {
      email: user.email,
      password: user.password,
    };
    if (next !== undefined) fields.next = next;
    expect(await redirectTarget(signIn(idle, form(fields)))).toBe("/");
  });

  test("a wrong password and an unknown email return the identical state", async () => {
    const user = await scope.createTestUser();
    mockNextRequest({ ip: scope.ip() });
    const wrongPassword = await signIn(
      idle,
      form({ email: user.email, password: "not-the-password" }),
    );
    mockNextRequest({ ip: scope.ip() });
    const unknownEmail = await signIn(
      idle,
      form({
        email: user.email.replace("@", "-nobody@"),
        password: "not-the-password",
      }),
    );

    expect(wrongPassword).toEqual({
      formError: "invalidCredentials",
      email: user.email,
    });
    expect(unknownEmail).toEqual({
      formError: "invalidCredentials",
      email: user.email.replace("@", "-nobody@"),
    });
    expect(await scope.sessionsOf(user.id)).toHaveLength(0);
    expect(readCookie(SESSION_COOKIE)).toBeUndefined();
  });

  test("a 9-character password reaches the library and is refused like any wrong one", async () => {
    const user = await scope.createTestUser();
    mockNextRequest({ ip: scope.ip() });
    const state = await signIn(
      idle,
      form({ email: user.email, password: "123456789" }),
    );
    expect(state.formError).toBe("invalidCredentials");
  });

  test("a suspended member with the correct password is told so and gets no session", async () => {
    const user = await scope.createTestUser({ status: "suspended" });
    mockNextRequest({ ip: scope.ip() });
    const state = await signIn(
      idle,
      form({ email: user.email, password: user.password }),
    );
    expect(state).toEqual({ formError: "suspended", email: user.email });
    expect(await scope.sessionsOf(user.id)).toHaveLength(0);
    expect(readCookie(SESSION_COOKIE)).toBeUndefined();
  });

  test("a suspended member with a wrong password gets the generic refusal", async () => {
    const user = await scope.createTestUser({ status: "suspended" });
    mockNextRequest({ ip: scope.ip() });
    const state = await signIn(
      idle,
      form({ email: user.email, password: "not-the-password" }),
    );
    expect(state.formError).toBe("invalidCredentials");
  });

  test("the 4th attempt in 10 s from one IP is refused; another IP is not", async () => {
    const user = await scope.createTestUser();
    const ip = scope.ip();
    const attempt = () =>
      signIn(idle, form({ email: user.email, password: "not-the-password" }));

    mockNextRequest({ ip });
    for (let i = 0; i < 3; i++) {
      expect((await attempt()).formError).toBe("invalidCredentials");
    }
    expect((await attempt()).formError).toBe("tooManyAttempts");

    mockNextRequest({ ip: scope.ip() });
    expect((await attempt()).formError).toBe("invalidCredentials");

    const rows = await scope.rateLimitRows();
    expect(rows.some((row) => row.key.startsWith(`${ip}|`))).toBe(true);
  });

  // The operator's log line carries neither the email nor the password.
  const expectLoggedOnce = (
    logged: ReturnType<typeof vi.spyOn>,
    payload: unknown,
  ) => {
    expect(logged.mock.calls).toEqual([["signIn: unexpected", payload]]);
    const text = JSON.stringify(logged.mock.calls);
    expect(text).not.toContain("mira@example.com");
    expect(text).not.toContain("secret-password");
  };

  test("a thrown library error is reported as unexpected and logged", async () => {
    mockNextRequest({ ip: scope.ip() });
    vi.spyOn(auth, "handler").mockRejectedValue(new Error("boom"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = await signIn(
      idle,
      form({ email: "mira@example.com", password: "secret-password" }),
    );
    expect(state).toEqual({
      formError: "unexpected",
      email: "mira@example.com",
    });
    expectLoggedOnce(
      logged,
      expect.objectContaining({ name: "Error", message: "boom" }),
    );
  });

  test.each([
    [500, { code: "INTERNAL" }],
    [403, { code: "INVALID_ORIGIN" }],
    [401, { code: "FAILED_TO_CREATE_SESSION" }],
  ])(
    "a %i response with %o is reported as unexpected and logged",
    async (status, body) => {
      mockNextRequest({ ip: scope.ip() });
      vi.spyOn(auth, "handler").mockResolvedValue(
        Response.json(body, { status }),
      );
      const logged = vi.spyOn(console, "error").mockImplementation(() => {});
      const state = await signIn(
        idle,
        form({ email: "mira@example.com", password: "secret-password" }),
      );
      expect(state.formError).toBe("unexpected");
      expectLoggedOnce(logged, { status, code: body.code });
    },
  );

  test("an expected refusal writes no log line", async () => {
    const user = await scope.createTestUser();
    mockNextRequest({ ip: scope.ip() });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const state = await signIn(
      idle,
      form({ email: user.email, password: "not-the-password" }),
    );
    expect(state.formError).toBe("invalidCredentials");
    expect(logged).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  test("deletes the current session, clears the cookie and redirects to /login", async () => {
    const user = await scope.createTestUser();
    const ip = scope.ip();
    const token = await signInForCookie({ ...user, ip });
    const other = await signInForCookie({ ...user, ip });
    mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: token } });

    expect(await redirectTarget(signOut())).toBe("/login");

    const remaining = await scope.sessionsOf(user.id);
    expect(remaining).toHaveLength(1);
    expect(other.startsWith(remaining[0].token)).toBe(true);
    expect(readCookie(SESSION_COOKIE)).toBeUndefined();
    expect(readCookieOptions(SESSION_COOKIE)).toMatchObject({
      maxAge: 0,
      path: "/",
    });
  });

  test("a forged call with no valid session redirects before any write", async () => {
    const user = await scope.createTestUser();
    const ip = scope.ip();
    await signInForCookie({ ...user, ip });
    // The library itself ignores a missing or forged cookie, so the proof that
    // the guard runs first is that the library is never reached.
    const librarySignOut = vi.spyOn(auth.api, "signOut");
    const deleteMany = vi.spyOn(db.session, "deleteMany");
    const del = vi.spyOn(db.session, "delete");

    const forged: Record<string, string>[] = [
      {},
      { [SESSION_COOKIE]: "forged.signature" },
    ];
    for (const cookies of forged) {
      mockNextRequest({ ip, cookies });
      expect(await redirectTarget(signOut())).toBe("/login");
    }

    expect(librarySignOut).not.toHaveBeenCalled();
    expect(deleteMany).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(await scope.sessionsOf(user.id)).toHaveLength(1);
  });

  test("a library failure is logged and rethrown: no redirect, the session stays", async () => {
    const user = await scope.createTestUser();
    const ip = scope.ip();
    const token = await signInForCookie({ ...user, ip });
    mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: token } });
    const failure = new Error("boom");
    vi.spyOn(auth.api, "signOut").mockRejectedValue(failure);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(signOut()).rejects.toBe(failure);

    expect(logged.mock.calls).toEqual([
      [
        "signOut: unexpected",
        expect.objectContaining({ name: "Error", message: "boom" }),
      ],
    ]);
    expect(await scope.sessionsOf(user.id)).toHaveLength(1);
    expect(readCookie(SESSION_COOKIE)).toBe(token);
  });

  test("a suspended member's leftover session is not deleted", async () => {
    const user = await scope.createTestUser();
    const ip = scope.ip();
    const token = await signInForCookie({ ...user, ip });
    await db.user.update({
      where: { id: user.id },
      data: { status: "suspended" },
    });
    mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: token } });

    expect(await redirectTarget(signOut())).toBe("/login");
    expect(await scope.sessionsOf(user.id)).toHaveLength(1);
  });
});
