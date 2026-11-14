import { formatMonth } from "@/lib/dates/dates";
import { LISTED_ITEMS_WARN_AT, UPLOAD_LIMITS } from "@/lib/photos/caps";
import { people } from "@/strings/people";
import { personName, toPhotoDTO, toUsageDTO } from "./mappers";

describe("toUsageDTO", () => {
  const zero = { monthCount: 0, storedBytes: 0, listedCount: 0 };
  const usage = (counts: Partial<typeof zero>) =>
    toUsageDTO({ ...zero, ...counts }, "2026-11-14");

  test.each([
    [1199, 79, false],
    [1200, 80, true],
    [1600, 106, true],
  ])("uploads %d → %d%%, warn %s (not clamped)", (used, percent, warn) => {
    expect(usage({ monthCount: used }).uploads).toEqual({
      used,
      percent,
      warn,
      cap: UPLOAD_LIMITS.monthly,
    });
  });

  test.each([
    [639_999_999, 79, false],
    [640_000_000, 80, true],
  ])("storage %d → %d%%, warn %s", (used, percent, warn) => {
    expect(usage({ storedBytes: used }).storedBytes).toEqual({
      used,
      percent,
      warn,
      cap: UPLOAD_LIMITS.storedBytes,
    });
  });

  test.each([
    [2399, 79, false],
    [2400, 80, false],
    [2999, 99, false],
    [3000, 100, true],
  ])(
    "listed %d → %d%%, warn %s (warns at the number, not at 80%%)",
    (used, percent, warn) => {
      expect(usage({ listedCount: used }).listedItems).toEqual({
        used,
        percent,
        warn,
        warnAt: LISTED_ITEMS_WARN_AT,
      });
    },
  );

  test("all zeros: 0%, no warnings, the month label from formatMonth", () => {
    const dto = usage({});
    expect(dto.monthLabel).toBe(formatMonth("2026-11-14"));
    for (const row of [dto.uploads, dto.storedBytes, dto.listedItems]) {
      expect(row).toMatchObject({ used: 0, percent: 0, warn: false });
    }
  });
});

describe("toPhotoDTO", () => {
  test("maps a complete photo to url, width and height only", () => {
    expect(
      toPhotoDTO({
        photoUrl: "https://x/p.webp",
        photoWidth: 1200,
        photoHeight: 900,
      }),
    ).toEqual({ url: "https://x/p.webp", width: 1200, height: 900 });
  });

  test.each([
    [{ photoUrl: null, photoWidth: 1200, photoHeight: 900 }],
    [{ photoUrl: "https://x/p.webp", photoWidth: null, photoHeight: 900 }],
    [{ photoUrl: "https://x/p.webp", photoWidth: 1200, photoHeight: null }],
    [{ photoUrl: null, photoWidth: null, photoHeight: null }],
  ])("is null unless all three are set (%j)", (row) => {
    expect(toPhotoDTO(row)).toBeNull();
  });
});

describe("personName", () => {
  test("is the display name", () => {
    expect(personName({ name: "Ana P." })).toBe("Ana P.");
  });

  test("is Former member for a deleted account (OQ-18)", () => {
    expect(personName(null)).toBe(people.formerMember);
  });
});
