import { z } from "zod";
import { categories } from "@/strings/categories";
import {
  CATEGORY_NAME_MAX,
  CATEGORY_NAME_MIN,
  categoryIdSchema,
  categorySchema,
  renameCategorySchema,
} from "./categories";

function nameErrors(input: Record<string, unknown>) {
  const result = categorySchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? [] : z.flattenError(result.error).fieldErrors.name;
}

describe("categorySchema", () => {
  test("limits are 2 and 30 (OQ-29)", () => {
    expect([CATEGORY_NAME_MIN, CATEGORY_NAME_MAX]).toEqual([2, 30]);
  });

  test.each([
    ["Garden", "Garden"],
    ["  Garden tools  ", "Garden tools"],
    ["Garden \t  tools", "Garden tools"],
    ["garden", "garden"],
  ])("name %j is stored as %j, casing kept", (name, expected) => {
    expect(categorySchema.parse({ name }).name).toBe(expected);
  });

  test("accepts 2 and 30 characters after normalisation", () => {
    expect(categorySchema.safeParse({ name: " ab " }).success).toBe(true);
    expect(
      categorySchema.safeParse({ name: `  ${"x".repeat(30)}  ` }).success,
    ).toBe(true);
    expect(
      categorySchema.safeParse({
        name: `${"x".repeat(14)}    ${"y".repeat(15)}`,
      }).success,
    ).toBe(true);
  });

  test.each([
    ["a", categories.nameTooShort],
    ["  a  ", categories.nameTooShort],
    ["", categories.nameTooShort],
    ["   ", categories.nameTooShort],
    ["x".repeat(31), categories.nameTooLong],
  ])("name %j is refused with its message", (name, message) => {
    expect(nameErrors({ name })).toEqual([message]);
  });

  test.each([[null], [undefined], [42]])(
    "a missing name (%j) is refused",
    (name) => {
      expect(nameErrors({ name })).toEqual([categories.nameTooShort]);
    },
  );

  test("has no server-controlled field", () => {
    expect(Object.keys(categorySchema.shape)).toEqual(["name"]);
  });
});

describe("categoryIdSchema", () => {
  test("needs a non-empty id", () => {
    expect(categoryIdSchema.safeParse({ id: "x" }).success).toBe(true);
    expect(categoryIdSchema.safeParse({ id: "" }).success).toBe(false);
    expect(categoryIdSchema.safeParse({ id: null }).success).toBe(false);
  });
});

describe("renameCategorySchema", () => {
  test("is the name rules plus the id, nothing else", () => {
    expect(Object.keys(renameCategorySchema.shape).sort()).toEqual([
      "id",
      "name",
    ]);
    expect(
      renameCategorySchema.parse({ id: "c1", name: "  Garden  tools " }),
    ).toEqual({ id: "c1", name: "Garden tools" });
  });
});
