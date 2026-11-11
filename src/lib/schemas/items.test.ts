import { z } from "zod";
import type { ItemCondition } from "@/generated/prisma/enums";
import { items } from "@/strings/items";
import {
  ITEM_CAP,
  ITEM_CONDITIONS,
  ITEM_DESCRIPTION_MAX,
  ITEM_MAX_LOAN_DAYS,
  ITEM_MAX_LOAN_DAYS_DEFAULT,
  ITEM_PICKUP_NOTES_MAX,
  ITEM_TITLE_MAX,
  ITEM_TITLE_MIN,
  itemDetailsSchema,
  itemIdSchema,
  updateItemSchema,
} from "./items";

const valid = {
  title: "Extension ladder",
  description: "Aluminium, 4 m.",
  categoryId: "cat-1",
  condition: "good",
  maxLoanDays: "7",
  pickupNotes: "Ring the side door.",
};

function errorsFor(input: Record<string, unknown>) {
  const result = itemDetailsSchema.safeParse(input);
  expect(result.success).toBe(false);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
}

describe("item limits", () => {
  test("match the brief", () => {
    expect([
      ITEM_TITLE_MIN,
      ITEM_TITLE_MAX,
      ITEM_DESCRIPTION_MAX,
      ITEM_PICKUP_NOTES_MAX,
      ITEM_MAX_LOAN_DAYS,
      ITEM_MAX_LOAN_DAYS_DEFAULT,
      ITEM_CAP,
    ]).toEqual([3, 80, 1000, 300, 30, 7, 30]);
  });

  test("ITEM_CONDITIONS is exactly Prisma's ItemCondition", () => {
    expectTypeOf<
      (typeof ITEM_CONDITIONS)[number]
    >().toEqualTypeOf<ItemCondition>();
    expect(ITEM_CONDITIONS).toEqual(["new", "good", "worn", "needs_care"]);
  });
});

describe("itemDetailsSchema", () => {
  test("parses a full form, coercing the days and trimming text", () => {
    expect(
      itemDetailsSchema.parse({
        ...valid,
        title: "  Extension ladder  ",
        categoryId: " cat-1 ",
      }),
    ).toEqual({
      title: "Extension ladder",
      description: "Aluminium, 4 m.",
      categoryId: "cat-1",
      condition: "good",
      maxLoanDays: 7,
      pickupNotes: "Ring the side door.",
    });
  });

  test("a missing description is empty; missing or blank pickup notes are null", () => {
    const rest = {
      title: valid.title,
      categoryId: valid.categoryId,
      condition: valid.condition,
      maxLoanDays: valid.maxLoanDays,
    };
    expect(itemDetailsSchema.parse(rest)).toMatchObject({
      description: "",
      pickupNotes: null,
    });
    expect(
      itemDetailsSchema.parse({ ...valid, pickupNotes: " \r\n " }).pickupNotes,
    ).toBeNull();
  });

  test.each([
    ["title", "abc", "x".repeat(80)],
    ["description", "", "x".repeat(1000)],
    ["pickupNotes", "x", "x".repeat(300)],
  ])("%s accepts its bounds", (key, low, high) => {
    expect(itemDetailsSchema.safeParse({ ...valid, [key]: low }).success).toBe(
      true,
    );
    expect(itemDetailsSchema.safeParse({ ...valid, [key]: high }).success).toBe(
      true,
    );
  });

  test.each([
    ["title", "ab", items.titleTooShort],
    ["title", "   ab   ", items.titleTooShort],
    ["title", "", items.titleTooShort],
    ["title", null, items.titleTooShort],
    ["title", "x".repeat(81), items.titleTooLong],
    ["description", "x".repeat(1001), items.descriptionTooLong],
    ["categoryId", "", items.categoryRequired],
    ["categoryId", "   ", items.categoryRequired],
    ["categoryId", null, items.categoryRequired],
    ["condition", "mint", items.conditionRequired],
    ["condition", "", items.conditionRequired],
    ["condition", null, items.conditionRequired],
    ["maxLoanDays", "0", items.maxLoanDaysRange],
    ["maxLoanDays", "31", items.maxLoanDaysRange],
    ["maxLoanDays", "2.5", items.maxLoanDaysRange],
    ["maxLoanDays", "seven", items.maxLoanDaysRange],
    ["maxLoanDays", "", items.maxLoanDaysRange],
    ["pickupNotes", "x".repeat(301), items.pickupNotesTooLong],
  ])("%s %j is refused with its message", (key, value, message) => {
    expect(errorsFor({ ...valid, [key]: value })).toEqual({ [key]: [message] });
  });

  test.each([1, 30])("maxLoanDays %d is accepted", (days) => {
    expect(
      itemDetailsSchema.parse({ ...valid, maxLoanDays: String(days) })
        .maxLoanDays,
    ).toBe(days);
  });

  // A CRLF counts as one character, never two.
  test.each([
    ["description", ITEM_DESCRIPTION_MAX],
    ["pickupNotes", ITEM_PICKUP_NOTES_MAX],
  ])("%s counts a CRLF once", (key, max) => {
    const half = "x".repeat(max / 2 - 1);
    const text = `${half}\r\n${half}x`;
    const parsed = itemDetailsSchema.parse({ ...valid, [key]: text });
    expect(parsed[key as "description"]).toBe(`${half}\n${half}x`);
    expect(errorsFor({ ...valid, [key]: `${text}x` })).toHaveProperty(key);
  });

  test("the field-error keys are the six field names", () => {
    expect(
      Object.keys(
        errorsFor({
          title: "",
          description: "x".repeat(1001),
          categoryId: "",
          condition: "",
          maxLoanDays: "",
          pickupNotes: "x".repeat(301),
        }),
      ).sort(),
    ).toEqual([
      "categoryId",
      "condition",
      "description",
      "maxLoanDays",
      "pickupNotes",
      "title",
    ]);
  });

  test("server-controlled keys are stripped", () => {
    const parsed = itemDetailsSchema.parse({
      ...valid,
      ownerId: "someone",
      status: "listed",
      listedAt: "2026-01-01",
      retiredAt: "2026-01-01",
      retiredNote: "x",
      retiredById: "someone",
      photoKey: "k",
      photoUrl: "u",
      photoWidth: "1",
      photoHeight: "1",
      photoBytes: "1",
      createdAt: "2026-01-01",
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "categoryId",
      "condition",
      "description",
      "maxLoanDays",
      "pickupNotes",
      "title",
    ]);
  });
});

describe("itemIdSchema and updateItemSchema", () => {
  test.each([[""], [null], [undefined], [42]])(
    "a bad id (%j) fails without a field message (the action says stale)",
    (id) => {
      const result = itemIdSchema.safeParse({ id });
      expect(result.success).toBe(false);
    },
  );

  test("updateItemSchema is the details plus the id", () => {
    expect(updateItemSchema.parse({ ...valid, id: "item-1" })).toMatchObject({
      id: "item-1",
      title: "Extension ladder",
      maxLoanDays: 7,
    });
    expect(updateItemSchema.safeParse(valid).success).toBe(false);
  });
});
