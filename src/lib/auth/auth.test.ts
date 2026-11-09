import type { BetterAuthOptions } from "better-auth";
import { auth } from "./auth";

// The configured options, read back from the instance.
describe("auth options", () => {
  const options: BetterAuthOptions = auth.options;

  test("30-day database sessions with no cookie cache", () => {
    expect(options.session?.expiresIn).toBe(2_592_000);
    expect(options.session?.cookieCache?.enabled ?? false).toBe(false);
  });

  test("rate limiting in database storage with the library's sign-in rule", () => {
    expect(options.rateLimit).toEqual({ enabled: true, storage: "database" });
  });

  test("email + password with sign-up refused and passwords of 10–128", () => {
    expect(options.emailAndPassword).toMatchObject({
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    });
    expect(options.emailAndPassword?.requireEmailVerification ?? false).toBe(
      false,
    );
  });

  test("role and status are never accepted from input", () => {
    const fields = options.user?.additionalFields;
    expect(fields?.role).toMatchObject({
      input: false,
      defaultValue: "member",
    });
    expect(fields?.status).toMatchObject({
      input: false,
      defaultValue: "active",
    });
    expect(fields?.area?.input).toBe(false);
    expect(fields?.contactDetails?.input).toBe(false);
  });

  test("no extra trusted origins, and nextCookies is the last plugin", () => {
    expect(options.trustedOrigins).toBeUndefined();
    expect(options.plugins?.at(-1)?.id).toBe("next-cookies");
  });
});
