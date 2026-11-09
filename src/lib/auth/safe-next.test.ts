import { safeNextPath } from "./safe-next";

describe("safeNextPath", () => {
  test.each([
    ["/", "/"],
    ["/items/a?b=1", "/items/a?b=1"],
    ["/my/loans?tab=lending#needs-you", "/my/loans?tab=lending#needs-you"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
    ["/admin/../items/x", "/items/x"],
  ])("keeps the internal path %s", (value, expected) => {
    expect(safeNextPath(value)).toBe(expected);
  });

  test.each([
    ["protocol-relative", "//evil.com"],
    ["protocol-relative with path", "//evil.com/items"],
    ["backslash", "/\\evil.com"],
    ["absolute URL", "https://x.example"],
    ["no leading slash", "items/a"],
    ["javascript scheme", "javascript:alert(1)"],
    ["the login page", "/login"],
    ["the login page with next", "/login?next=/"],
    ["under /login/", "/login/extra"],
    ["dot-segment to login", "/items/../login"],
    ["dot-segment to protocol-relative", "/.//evil.com"],
    ["parent segment to protocol-relative", "/x/..//evil.com"],
    ["encoded dot-segment to protocol-relative", "/%2e//evil.com"],
    ["encoded parent segment to protocol-relative", "/%2E%2E//evil.com"],
    ["an auth endpoint", "/api/auth/sign-out"],
    ["the cron endpoint", "/api/cron/daily"],
    ["empty", ""],
    ["whitespace inside", "/items/a b"],
    ["leading whitespace", " /items"],
    ["tab", "/items\t/x"],
    ["newline", "/items\n/x"],
    ["NUL", "/items\u0000"],
    ["DEL", "/items\u007f"],
    ["non-breaking space", "/items x"],
  ])("falls back to / for %s", (_case, value) => {
    expect(safeNextPath(value)).toBe("/");
  });

  test.each([null, undefined])("falls back to / for %s", (value) => {
    expect(safeNextPath(value)).toBe("/");
  });
});
