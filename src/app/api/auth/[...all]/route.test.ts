import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { db } from "@/db";
import { env } from "@/lib/env/server";
import * as route from "./route";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

describe("/api/auth/[...all]", () => {
  test("exports GET and POST only", () => {
    expect(Object.keys(route).sort()).toEqual(["GET", "POST"]);
  });

  test("refuses email sign-up with 400 and creates no user", async () => {
    const email = scope.email();
    const response = await route.POST(
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
    expect(await response.json()).toMatchObject({
      code: "EMAIL_PASSWORD_SIGN_UP_DISABLED",
    });
    expect(await db.user.findUnique({ where: { email } })).toBeNull();
  });

  test("update-user is disabled: 404 for a signed-in member, nothing changes", async () => {
    const user = await scope.createTestUser();
    const ip = scope.ip();
    const token = await signInForCookie({ ...user, ip });
    const fields = () =>
      db.user.findUnique({
        where: { id: user.id },
        select: {
          name: true,
          image: true,
          role: true,
          status: true,
          area: true,
          contactDetails: true,
        },
      });
    const before = await fields();

    // Control: the same session reaches a live route, so the 404 isn't a 401.
    const session = await post("/get-session", token, ip, undefined, "GET");
    expect(session.status).toBe(200);

    // Fields the library would accept: a name that skips profileSchema, an image.
    const response = await post("/update-user", token, ip, {
      name: " x",
      image: "https://example.test/x.png",
    });

    expect(response.status).toBe(404);
    expect(await fields()).toEqual(before);
  });

  describe("change-password demands revokeOtherSessions: true", () => {
    test.each([
      ["omitted", {}],
      ["false", { revokeOtherSessions: false }],
      ["the string 'true'", { revokeOtherSessions: "true" }],
    ])("refuses it %s and changes nothing", async (_, option) => {
      const user = await scope.createTestUser();
      const token = await signInForCookie({ ...user, ip: scope.ip() });
      const credential = () =>
        db.account.findFirstOrThrow({
          where: { userId: user.id, providerId: "credential" },
          select: { password: true },
        });
      const hashBefore = (await credential()).password;
      const sessionsBefore = await scope.sessionsOf(user.id);

      const response = await post("/change-password", token, scope.ip(), {
        currentPassword: user.password,
        newPassword: "a-brand-new-password",
        ...option,
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "REVOKE_OTHER_SESSIONS_REQUIRED",
      });
      expect((await credential()).password).toBe(hashBefore);
      expect(await scope.sessionsOf(user.id)).toEqual(sessionsBefore);
    });

    test("accepts it with the flag: every old session goes", async () => {
      const user = await scope.createTestUser();
      const token = await signInForCookie({ ...user, ip: scope.ip() });
      const [old] = await scope.sessionsOf(user.id);

      const response = await post("/change-password", token, scope.ip(), {
        currentPassword: user.password,
        newPassword: "a-brand-new-password",
        revokeOtherSessions: true,
      });

      expect(response.status).toBe(200);
      const after = await scope.sessionsOf(user.id);
      expect(after.map(({ id }) => id)).not.toContain(old.id);
    });
  });
});

function post(
  path: string,
  token: string,
  ip: string,
  body?: object,
  method: "GET" | "POST" = "POST",
): Promise<Response> {
  return route[method](
    new Request(new URL(`/api/auth${path}`, env.APP_URL), {
      method,
      headers: {
        "content-type": "application/json",
        origin: new URL(env.APP_URL).origin,
        "x-forwarded-for": ip,
        cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}
