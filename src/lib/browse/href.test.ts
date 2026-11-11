import { browseHref } from "./href";

describe("browseHref", () => {
  test("no parameters → /", () => {
    expect(browseHref({})).toBe("/");
  });

  test("defaults are left out", () => {
    expect(browseHref({ q: "drill", page: 1 })).toBe("/?q=drill");
    expect(browseHref({ q: "", category: null, page: 1 })).toBe("/");
  });

  test("q, category and page in that order", () => {
    expect(browseHref({ page: 2, category: "c1", q: "pan" })).toBe(
      "/?q=pan&category=c1&page=2",
    );
  });

  test("values are URL-encoded", () => {
    expect(browseHref({ q: "50% & more" })).toBe("/?q=50%25+%26+more");
  });
});
