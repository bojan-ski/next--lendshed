import { z } from "zod";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import {
  changePasswordSchema,
  contactDetailsSchema,
  profileSchema,
} from "./account";

function fieldErrorsOf(result: { success: boolean; error?: z.ZodError }) {
  expect(result.success).toBe(false);
  return z.flattenError(result.error!).fieldErrors as Record<string, string[]>;
}

describe("profileSchema", () => {
  test("trims the name and the area", () => {
    expect(
      profileSchema.parse({ name: "  Mira K.  ", area: "  north end " }),
    ).toEqual({ name: "Mira K.", area: "north end" });
  });

  test.each([undefined, null, "", "   "])(
    "an area of %j is stored as null",
    (area) => {
      expect(profileSchema.parse({ name: "Mira K.", area }).area).toBeNull();
    },
  );

  test.each([
    ["M", account.nameTooShort],
    ["  M  ", account.nameTooShort],
    ["M".repeat(41), account.nameTooLong],
  ])("the name %j is refused", (name, message) => {
    expect(fieldErrorsOf(profileSchema.safeParse({ name })).name).toEqual([
      message,
    ]);
  });

  test("a missing name is refused as too short", () => {
    expect(fieldErrorsOf(profileSchema.safeParse({})).name).toEqual([
      account.nameTooShort,
    ]);
  });

  test("the limits are inclusive: 2 and 40 characters, area 40", () => {
    expect(profileSchema.safeParse({ name: "Mi" }).success).toBe(true);
    expect(
      profileSchema.safeParse({ name: "M".repeat(40), area: "a".repeat(40) })
        .success,
    ).toBe(true);
  });

  test("a 41-character area is refused", () => {
    expect(
      fieldErrorsOf(
        profileSchema.safeParse({ name: "Mira K.", area: "a".repeat(41) }),
      ).area,
    ).toEqual([account.areaTooLong]);
  });
});

describe("contactDetailsSchema", () => {
  const parse = (contactDetails: unknown) =>
    contactDetailsSchema.safeParse({ contactDetails });

  test("keeps inner line breaks and normalises CRLF to LF", () => {
    expect(
      contactDetailsSchema.parse({
        contactDetails: "  Phone 555 0103\r\nEvenings after 6\r\n  ",
      }),
    ).toEqual({ contactDetails: "Phone 555 0103\nEvenings after 6" });
  });

  test("counts a CRLF break once: 300 normalised characters pass", () => {
    const lines = Array.from({ length: 30 }, () => "a".repeat(9));
    const text = lines.join("\r\n"); // 270 + 29 breaks = 299 normalised
    expect(text.length).toBe(328);
    expect(parse(`${text}b`).success).toBe(true);
  });

  test("301 normalised characters are refused", () => {
    const text = `${"a".repeat(150)}\r\n${"a".repeat(150)}`;
    expect(fieldErrorsOf(parse(text)).contactDetails).toEqual([
      account.contactTooLong,
    ]);
  });

  test.each(["", "   ", "\r\n\r\n", " \n "])(
    "%j means clear and becomes null",
    (value) => {
      expect(contactDetailsSchema.parse({ contactDetails: value })).toEqual({
        contactDetails: null,
      });
    },
  );

  test("a missing field is a malformed submit, not a clear", () => {
    expect(fieldErrorsOf(parse(undefined)).contactDetails).toEqual([
      errors.actionFailed,
    ]);
  });
});

describe("changePasswordSchema", () => {
  test("passwords are kept exactly, spaces included", () => {
    expect(
      changePasswordSchema.parse({
        currentPassword: " old one ",
        newPassword: "  ten chars ",
      }),
    ).toEqual({ currentPassword: " old one ", newPassword: "  ten chars " });
  });

  test("the current password has no 10-character minimum", () => {
    expect(
      changePasswordSchema.safeParse({
        currentPassword: "x",
        newPassword: "a".repeat(10),
      }).success,
    ).toBe(true);
  });

  test.each([
    [
      { currentPassword: "", newPassword: "a".repeat(10) },
      "currentPassword",
      account.currentPasswordRequired,
    ],
    [
      { newPassword: "a".repeat(10) },
      "currentPassword",
      account.currentPasswordRequired,
    ],
    [
      { currentPassword: "a".repeat(129), newPassword: "a".repeat(10) },
      "currentPassword",
      account.passwordTooLong,
    ],
    [
      { currentPassword: "x", newPassword: "a".repeat(9) },
      "newPassword",
      account.passwordTooShort,
    ],
    [{ currentPassword: "x" }, "newPassword", account.passwordTooShort],
    [
      { currentPassword: "x", newPassword: "a".repeat(129) },
      "newPassword",
      account.passwordTooLong,
    ],
  ])("%j is refused on %s", (input, key, message) => {
    expect(fieldErrorsOf(changePasswordSchema.safeParse(input))[key]).toEqual([
      message,
    ]);
  });

  test("the new password may be 10 to 128 characters", () => {
    for (const length of [10, 128]) {
      expect(
        changePasswordSchema.safeParse({
          currentPassword: "x",
          newPassword: "a".repeat(length),
        }).success,
      ).toBe(true);
    }
  });
});
