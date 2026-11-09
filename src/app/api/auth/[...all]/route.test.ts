import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
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
});
