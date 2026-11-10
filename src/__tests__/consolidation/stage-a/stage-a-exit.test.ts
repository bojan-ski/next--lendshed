import { isRedirectError } from "next/dist/client/components/redirect-error";
import { NextRequest } from "next/server";
import { bootstrapOrganizer } from "../../../../scripts/lib/bootstrap-organizer";
import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
  TEST_PASSWORD,
} from "@/__tests__/support/test-db";
import { signIn, signOut } from "@/actions/auth";
import * as authRoute from "@/app/api/auth/[...all]/route";
import ViewerGate from "@/components/auth/ViewerGate";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { auth } from "@/lib/auth/auth";
import { PATH_HEADER, safeNextPath } from "@/lib/auth/safe-next";
import { env } from "@/lib/env/server";
import { proxy } from "@/proxy";
import type { SignInState } from "@/types/auth";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// The Build Stages exit condition for Stage A, end to end. Midnight/DST is proven
// by spec 02's suites at the gates; the suspended *seed* member's sign-in by
// prisma/seed/people.test.ts. Every row here is this file's own.

const ORIGIN = "http://localhost:3000";
const idle: SignInState = {};
const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

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

describe("Stage A exit condition", () => {
  test("(a) a guest hitting / lands on /login?next=%2F", () => {
    const response = proxy(new NextRequest(`${ORIGIN}/`));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/login?next=%2F`);
  });

  test("(b) a stale cookie reaches ViewerGate, which redirects with a validated next", async () => {
    const path = "/.//evil.example/x?y=1";
    const response = proxy(
      new NextRequest(`${ORIGIN}${path}`, {
        headers: { cookie: `${SESSION_COOKIE}=stale.sig` },
      }),
    );
    const forwarded = response.headers.get(
      `x-middleware-request-${PATH_HEADER}`,
    )!;
    mockNextRequest({
      ip: scope.ip(),
      cookies: { [SESSION_COOKIE]: "stale.sig" },
      path: forwarded,
    });

    const target = await redirectTarget(
      ViewerGate({ children: null }) as Promise<unknown>,
    );

    const next = new URL(target, ORIGIN).searchParams.get("next");
    expect(new URL(target, ORIGIN).pathname).toBe("/login");
    expect(next).toBe(safeNextPath(forwarded));
    expect(next).not.toMatch(/^\/\//);
  });

  test("(c) the bootstrap organizer signs in as an organizer", async () => {
    const email = scope.email();
    const result = await bootstrapOrganizer(db, {
      name: "Ada Organizer",
      email,
      password: TEST_PASSWORD,
    });
    scope.track(result.userId);
    expect(result.outcome).toBe("created");

    mockNextRequest({ ip: scope.ip() });
    expect(
      await redirectTarget(
        signIn(idle, form({ email, password: TEST_PASSWORD })),
      ),
    ).toBe("/");
    expect(await getViewer()).toMatchObject({
      id: result.userId,
      role: "organizer",
    });
  });

  test("(d) a suspended member is told only after a correct password", async () => {
    const user = await scope.createTestUser({ status: "suspended" });

    mockNextRequest({ ip: scope.ip() });
    expect(
      await signIn(idle, form({ email: user.email, password: user.password })),
    ).toMatchObject({ formError: "suspended" });
    expect(await scope.sessionsOf(user.id)).toEqual([]);

    mockNextRequest({ ip: scope.ip() });
    expect(
      await signIn(
        idle,
        form({ email: user.email, password: `${user.password}-wrong` }),
      ),
    ).toMatchObject({ formError: "invalidCredentials" });
    expect(await scope.sessionsOf(user.id)).toEqual([]);
  });

  test("(e) the email sign-up endpoint refuses and creates no user", async () => {
    const email = scope.email();
    const response = await authRoute.POST(
      new Request(new URL("/api/auth/sign-up/email", env.APP_URL), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: new URL(env.APP_URL).origin,
          "x-forwarded-for": scope.ip(),
        },
        body: JSON.stringify({
          email,
          password: "long-enough-password",
          name: "Eve",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  test("(f) a forged signOut is rejected before any write", async () => {
    const user = await scope.createTestUser();
    const ip = scope.ip();
    await signInForCookie({ ...user, ip });
    const librarySignOut = vi.spyOn(auth.api, "signOut");

    const forged: Record<string, string>[] = [
      {},
      { [SESSION_COOKIE]: "forged.signature" },
    ];
    for (const cookies of forged) {
      mockNextRequest({ ip, cookies });
      expect(await redirectTarget(signOut())).toBe("/login");
    }

    expect(librarySignOut).not.toHaveBeenCalled();
    expect(await scope.sessionsOf(user.id)).toHaveLength(1);
  });
});
