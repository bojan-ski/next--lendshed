import { BROWSE_MAX_PAGE, browseQuerySchema } from "./browse";

describe("browseQuerySchema", () => {
  test("nothing given → no search, no category, page 1", () => {
    expect(browseQuerySchema.parse({})).toEqual({
      q: "",
      category: null,
      page: 1,
    });
  });

  test("valid values pass through, q and category trimmed", () => {
    expect(
      browseQuerySchema.parse({ q: "  drill ", category: " c1 ", page: "3" }),
    ).toEqual({ q: "drill", category: "c1", page: 3 });
  });

  test.each([
    ["0"],
    ["-1"],
    ["abc"],
    ["1.5"],
    [String(BROWSE_MAX_PAGE + 1)],
    [["2", "3"]],
  ])("page %j falls back to 1", (page) => {
    expect(browseQuerySchema.parse({ page }).page).toBe(1);
  });

  test("the last allowed page is kept", () => {
    expect(browseQuerySchema.parse({ page: "500" }).page).toBe(500);
  });

  test("q over 80 characters, or an array, falls back to no search", () => {
    expect(browseQuerySchema.parse({ q: "a".repeat(81) }).q).toBe("");
    expect(browseQuerySchema.parse({ q: "a".repeat(80) }).q).toHaveLength(80);
    expect(browseQuerySchema.parse({ q: ["a", "b"] }).q).toBe("");
  });

  test("an empty, over-long or repeated category falls back to none", () => {
    for (const category of ["", "   ", "c".repeat(65), ["c1", "c2"]]) {
      expect(browseQuerySchema.parse({ category }).category).toBeNull();
    }
  });

  test("one bad field never spoils the others", () => {
    expect(
      browseQuerySchema.parse({ q: "pan", category: "", page: "x" }),
    ).toEqual({ q: "pan", category: null, page: 1 });
  });
});
