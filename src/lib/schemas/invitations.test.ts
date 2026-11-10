import { z } from "zod";
import { invitations } from "@/strings/invitations";
import { join } from "@/strings/join";
import {
  invitationIdSchema,
  invitationSchema,
  joinSchema,
  joinTokenSchema,
} from "./invitations";

const TOKEN = "A".repeat(43);
const valid = {
  token: TOKEN,
  name: "Mira K.",
  email: "mira@example.com",
  password: "correct-horse",
  acceptHouseRules: "on",
};

function joinErrors(input: Record<string, unknown>) {
  const result = joinSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
}

describe("invitationSchema", () => {
  test.each([
    ["  Mira, no. 14  ", "Mira, no. 14"],
    ["", null],
    ["   ", null],
    [null, null],
    [undefined, null],
  ])("note %j becomes %j", (note, expected) => {
    expect(invitationSchema.parse({ note }).note).toBe(expected);
  });

  test("accepts 80 characters and refuses 81", () => {
    expect(invitationSchema.safeParse({ note: "x".repeat(80) }).success).toBe(
      true,
    );
    const result = invitationSchema.safeParse({ note: "x".repeat(81) });
    expect(result.success).toBe(false);
    expect(
      result.success ? [] : z.flattenError(result.error).fieldErrors.note,
    ).toEqual([invitations.noteTooLong]);
  });

  test("has no server-controlled field", () => {
    expect(Object.keys(invitationSchema.shape)).toEqual(["note"]);
  });
});

describe("invitationIdSchema", () => {
  test("needs a non-empty id", () => {
    expect(invitationIdSchema.safeParse({ id: "x" }).success).toBe(true);
    expect(invitationIdSchema.safeParse({ id: "" }).success).toBe(false);
    expect(invitationIdSchema.safeParse({ id: null }).success).toBe(false);
  });
});

describe("joinTokenSchema", () => {
  test.each([
    ["43 base64url characters", TOKEN, true],
    ["with - and _", `${"a".repeat(41)}-_`, true],
    ["42 characters", "A".repeat(42), false],
    ["44 characters", "A".repeat(44), false],
    ["padding", `${"A".repeat(42)}=`, false],
    ["a slash", `${"A".repeat(42)}/`, false],
    ["null", null, false],
  ])("%s → %s", (_label, token, ok) => {
    expect(joinTokenSchema.safeParse({ token }).success).toBe(ok);
  });
});

describe("joinSchema", () => {
  test("trims the name, trims and lower-cases the email, keeps the password as typed", () => {
    expect(
      joinSchema.parse({
        ...valid,
        name: "  Mira K. ",
        email: " Mira@Example.COM ",
        password: " spaced pass ",
      }),
    ).toEqual({
      token: TOKEN,
      name: "Mira K.",
      email: "mira@example.com",
      password: " spaced pass ",
      acceptHouseRules: true,
    });
  });

  test.each<["name" | "email" | "password", string, string]>([
    ["name", "M", join.nameTooShort],
    ["name", "  M  ", join.nameTooShort],
    ["name", "M".repeat(41), join.nameTooLong],
    ["email", "", join.emailRequired],
    ["email", "not-an-email", join.emailInvalid],
    ["password", "123456789", join.passwordTooShort],
    ["password", "x".repeat(129), join.passwordTooLong],
  ])("%s %j → %s", (field, value, message) => {
    expect(joinErrors({ ...valid, [field]: value })[field]).toEqual([message]);
  });

  test.each([
    ["name", "Mi"],
    ["name", "M".repeat(40)],
    ["password", "1234567890"],
    ["password", "x".repeat(128)],
  ])("accepts %s %j at the limit", (field, value) => {
    expect(joinSchema.safeParse({ ...valid, [field]: value }).success).toBe(
      true,
    );
  });

  test.each([undefined, "off", "true", ""])(
    "house rules %j is refused",
    (value) => {
      expect(joinErrors({ ...valid, acceptHouseRules: value })).toEqual({
        acceptHouseRules: [join.houseRulesRequired],
      });
    },
  );

  test("has no server-controlled field", () => {
    expect(Object.keys(joinSchema.shape).sort()).toEqual([
      "acceptHouseRules",
      "email",
      "name",
      "password",
      "token",
    ]);
  });
});
