import { z } from "zod";
import { login } from "@/strings/login";
import { signInSchema } from "./auth";

const valid = { email: "mira@example.com", password: "hunter2", next: null };

function fieldErrors(input: Record<string, unknown>) {
  const result = signInSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
}

describe("signInSchema", () => {
  test("trims and lower-cases the email", () => {
    const parsed = signInSchema.parse({
      ...valid,
      email: "  Mira@Example.COM ",
    });
    expect(parsed.email).toBe("mira@example.com");
  });

  test("accepts a 9-character password: no 10-character minimum at sign-in", () => {
    expect(
      signInSchema.safeParse({ ...valid, password: "123456789" }).success,
    ).toBe(true);
  });

  test("accepts a 128-character password and refuses 129", () => {
    expect(
      signInSchema.safeParse({ ...valid, password: "x".repeat(128) }).success,
    ).toBe(true);
    expect(
      fieldErrors({ ...valid, password: "x".repeat(129) }).password,
    ).toEqual([login.passwordTooLong]);
  });

  test.each([
    ["missing", null],
    ["empty", ""],
    ["blank", "   "],
  ])("a %s email asks for one", (_case, email) => {
    expect(fieldErrors({ ...valid, email }).email).toEqual([
      login.emailRequired,
    ]);
  });

  test("a malformed email asks for a valid one", () => {
    expect(fieldErrors({ ...valid, email: "mira@" }).email).toEqual([
      login.emailInvalid,
    ]);
  });

  test.each([
    ["missing", null],
    ["empty", ""],
  ])("a %s password asks for one", (_case, password) => {
    expect(fieldErrors({ ...valid, password }).password).toEqual([
      login.passwordRequired,
    ]);
  });

  test.each([
    [null, "/"],
    [undefined, "/"],
    ["/items/a?b=1", "/items/a?b=1"],
    ["//evil.com", "/"],
    ["/login", "/"],
  ])("next %s becomes %s", (next, expected) => {
    expect(signInSchema.parse({ ...valid, next }).next).toBe(expected);
  });
});
