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

  test("update-user can't set role, status, area or contact details", async () => {
    const user = await scope.createTestUser();
    const ip = scope.ip();
    const token = await signInForCookie({ ...user, ip });
    const updateUser = (body: object) =>
      route.POST(
        new Request(new URL("/api/auth/update-user", env.APP_URL), {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: new URL(env.APP_URL).origin,
            "x-forwarded-for": ip,
            cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
          },
          body: JSON.stringify(body),
        }),
      );
    const fields = () =>
      db.user.findUnique({
        where: { id: user.id },
        select: { role: true, status: true, area: true, contactDetails: true },
      });
    const before = await fields();

    // Control: the same session is accepted, so a refusal below isn't a 401.
    expect((await updateUser({ name: "Mira Q." })).status).toBe(200);

    const response = await updateUser({
      role: "organizer",
      status: "suspended",
      area: "Elsewhere",
      contactDetails: "",
    });

    // The library refuses `input: false` fields; whatever it answers, nothing changes.
    expect(response.status).not.toBe(200);
    expect(await fields()).toEqual(before);
    expect(before).toMatchObject({ role: "member", status: "active" });
  });
});
