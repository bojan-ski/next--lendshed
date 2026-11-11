import { categoryNameKey, normaliseCategoryName } from "./name";
import { PRODUCTION_CATEGORIES } from "./production";

describe("normaliseCategoryName", () => {
  test.each([
    ["Garden", "Garden"],
    ["  Garden tools ", "Garden tools"],
    ["Garden \t\n  tools", "Garden tools"],
    ["", ""],
  ])("%j becomes %j", (name, expected) => {
    expect(normaliseCategoryName(name)).toBe(expected);
  });
});

describe("categoryNameKey", () => {
  test("names differing only in case or spacing share a key", () => {
    expect(categoryNameKey("  Garden   Tools ")).toBe("garden tools");
    expect(categoryNameKey("garden tools")).toBe("garden tools");
    expect(categoryNameKey("GARDEN TOOLS")).toBe("garden tools");
  });

  test("the five production names have distinct keys", () => {
    expect(PRODUCTION_CATEGORIES).toEqual([
      "Tools",
      "Garden",
      "Kitchen",
      "Outdoors",
      "Kids",
    ]);
    expect(new Set(PRODUCTION_CATEGORIES.map(categoryNameKey)).size).toBe(5);
  });
});
