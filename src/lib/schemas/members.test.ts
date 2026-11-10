import { resetPassword } from "@/strings/resetPassword";
import {
  memberIdSchema,
  memberSearchSchema,
  resetPasswordSchema,
} from "./members";

const TOKEN = "A".repeat(43);

describe("memberSearchSchema", () => {
  test.each([
    ["a name", { q: "mir" }, "mir"],
    ["surrounding spaces", { q: "  Mira K. " }, "Mira K."],
    ["exactly 40 characters", { q: "x".repeat(40) }, "x".repeat(40)],
    ["41 characters", { q: "x".repeat(41) }, ""],
    ["a repeated q", { q: ["mir", "ada"] }, ""],
    ["no q", {}, ""],
    ["only spaces", { q: "   " }, ""],
  ])("%s → %j", (_label, input, q) => {
    expect(memberSearchSchema.parse(input)).toEqual({ q });
  });

  test("other params are dropped", () => {
    expect(memberSearchSchema.parse({ q: "mir", page: "2" })).toEqual({
      q: "mir",
    });
  });
});

describe("memberIdSchema", () => {
  test("accepts any non-empty id", () => {
    expect(memberIdSchema.safeParse({ id: "u1" }).success).toBe(true);
  });

  test.each([[""], [null], [undefined]])("refuses %j", (id) => {
    expect(memberIdSchema.safeParse({ id }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  test("accepts a 43-character base64url token and a 10–128 password, untrimmed", () => {
    expect(
      resetPasswordSchema.parse({ token: TOKEN, password: " ten chars " }),
    ).toEqual({ token: TOKEN, password: " ten chars " });
    expect(
      resetPasswordSchema.safeParse({ token: TOKEN, password: "x".repeat(128) })
        .success,
    ).toBe(true);
  });

  test.each([
    ["42 characters", "A".repeat(42)],
    ["44 characters", "A".repeat(44)],
    ["a character outside base64url", `${"A".repeat(42)}=`],
  ])("a token of %s fails on the token", (_label, token) => {
    const result = resetPasswordSchema.safeParse({
      token,
      password: "x".repeat(10),
    });
    expect(result.error?.issues.map((issue) => issue.path[0])).toEqual([
      "token",
    ]);
  });

  test.each([
    ["9 characters", "x".repeat(9), resetPassword.passwordTooShort],
    ["129 characters", "x".repeat(129), resetPassword.passwordTooLong],
    ["missing", undefined, resetPassword.passwordTooShort],
  ])(
    "a password of %s has the strings message",
    (_label, password, message) => {
      const result = resetPasswordSchema.safeParse({ token: TOKEN, password });
      expect(result.error?.issues.map((issue) => issue.message)).toEqual([
        message,
      ]);
    },
  );
});
