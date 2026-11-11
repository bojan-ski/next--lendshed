import { UPLOAD_LIMITS, uploadCapRefusal } from "./caps";

const under = { monthCount: 1499, dayCount: 19, storedBytes: 799_999_999 };

describe("uploadCapRefusal", () => {
  test("the limits are the free-tier numbers (decimal MB)", () => {
    expect(UPLOAD_LIMITS).toEqual({
      monthly: 1500,
      dailyPerMember: 20,
      storedBytes: 800_000_000,
    });
  });

  test.each([
    ["everything one under", under, null],
    ["1,500 this month", { ...under, monthCount: 1500 }, "monthlyCap"],
    ["20 today", { ...under, dayCount: 20 }, "dailyCap"],
    [
      "800,000,000 bytes stored",
      { ...under, storedBytes: 800_000_000 },
      "storageFull",
    ],
    [
      "all three hit",
      { monthCount: 1500, dayCount: 20, storedBytes: 800_000_000 },
      "storageFull",
    ],
    [
      "monthly and daily",
      { ...under, monthCount: 1500, dayCount: 20 },
      "monthlyCap",
    ],
    [
      "storage and daily",
      { ...under, storedBytes: 900_000_000, dayCount: 25 },
      "storageFull",
    ],
  ] as const)("%s → %s", (_case, counts, expected) => {
    expect(uploadCapRefusal(counts)).toBe(expected);
  });
});
