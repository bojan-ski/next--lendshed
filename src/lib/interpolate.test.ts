import { t } from "./interpolate";

describe("t", () => {
  test("replaces every {name} token", () => {
    expect(t("{a} and {b}, {a} again", { a: "one", b: 2 })).toBe(
      "one and 2, one again",
    );
  });

  test("leaves unmatched tokens intact", () => {
    expect(t("Hello {name}, from {appName}", { name: "Ruth" })).toBe(
      "Hello Ruth, from {appName}",
    );
  });

  test("leaves non-token text such as Next's %s slot alone", () => {
    expect(t("%s · {appName}", { appName: "Lendshed" })).toBe("%s · Lendshed");
  });

  test("ignores inherited object keys", () => {
    expect(t("{toString}", {})).toBe("{toString}");
  });
});
