import { formatCount, formatMegabytes } from "./numbers";

describe("formatCount", () => {
  test.each([
    [0, "0"],
    [64, "64"],
    [999, "999"],
    [1000, "1,000"],
    [1500, "1,500"],
    [800_000_000, "800,000,000"],
  ])("formatCount(%d) is %j", (n, expected) => {
    expect(formatCount(n)).toBe(expected);
  });
});

describe("formatMegabytes", () => {
  test.each([
    [41_300_000, "41.3"],
    [800_000_000, "800"],
    [799_999_999, "799.9"],
    [399_999, "0.3"],
    [99_999, "0"],
    [0, "0"],
    [1_500_000_000, "1,500"],
  ])(
    "formatMegabytes(%d) is %j (rounded down, no trailing .0)",
    (bytes, expected) => {
      expect(formatMegabytes(bytes)).toBe(expected);
    },
  );
});
