import { isCronAuthorized } from "./cron-auth";

const SECRET = "cron-secret-0123456789abcdefghijk";

describe("isCronAuthorized", () => {
  test("accepts exactly `Bearer ${secret}`", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  test.each([
    ["the secret is unset", `Bearer ${SECRET}`, undefined],
    ["the secret is empty", "Bearer ", ""],
    ["the header is missing", null, SECRET],
    ["another scheme", `Basic ${SECRET}`, SECRET],
    ["a lower-case scheme", `bearer ${SECRET}`, SECRET],
    ["two spaces", `Bearer  ${SECRET}`, SECRET],
    ["a wrong value", "Bearer something-else", SECRET],
    ["one character short", `Bearer ${SECRET.slice(0, -1)}`, SECRET],
    ["one character more", `Bearer ${SECRET}x`, SECRET],
    [
      "an equal-length wrong value",
      `Bearer ${"x".repeat(SECRET.length)}`,
      SECRET,
    ],
    ["the bare secret", SECRET, SECRET],
  ])("refuses when %s", (_case, header, secret) => {
    expect(isCronAuthorized(header, secret)).toBe(false);
  });
});
