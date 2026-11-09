import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import { strings } from "@/strings";
import {
  addDays,
  communityToday,
  daysBetween,
  formatDate,
  formatDateRange,
  isIsoDate,
  loanLengthDays,
} from "./dates";

const LOCAL_MIDNIGHTS: [date: string, instant: string][] = [
  ["2026-03-29", "2026-03-28T23:00:00Z"],
  ["2026-03-30", "2026-03-29T22:00:00Z"],
  ["2026-10-25", "2026-10-24T22:00:00Z"],
  ["2026-10-26", "2026-10-25T23:00:00Z"],
  ["2026-11-15", "2026-11-14T23:00:00Z"],
  ["2027-01-01", "2026-12-31T23:00:00Z"],
  ["2027-03-28", "2027-03-27T23:00:00Z"],
  ["2027-03-29", "2027-03-28T22:00:00Z"],
  ["2027-07-15", "2027-07-14T22:00:00Z"],
  ["2027-10-31", "2027-10-30T22:00:00Z"],
  ["2027-11-01", "2027-10-31T23:00:00Z"],
];

const utcDate = (instant: Date) => instant.toISOString().slice(0, 10);

test("importing the date modules reads no clock", async () => {
  const clockRead = () => {
    throw new Error("clock read at import");
  };
  vi.resetModules();
  vi.stubGlobal(
    "Date",
    new Proxy(Date, {
      construct: clockRead,
      get: (target, key) =>
        key === "now" ? clockRead : Reflect.get(target, key),
    }),
  );
  vi.stubGlobal("Intl", { ...Intl, DateTimeFormat: clockRead });
  try {
    await import("./dates");
    await import("./effective-status");
  } finally {
    vi.unstubAllGlobals();
  }
});

describe.each(TEST_ZONES)("dates with process TZ=%s", (zone) => {
  useProcessTimeZone(zone);

  describe("communityToday", () => {
    test.each(LOCAL_MIDNIGHTS)(
      "%s starts at %s and not a second earlier",
      (date, instant) => {
        const midnight = new Date(instant);
        expect(communityToday(midnight)).toBe(date);
        expect(communityToday(new Date(midnight.getTime() - 1000))).toBe(
          addDays(date, -1),
        );
      },
    );

    test("never returns the UTC date when the two differ", () => {
      for (const [, instant] of LOCAL_MIDNIGHTS) {
        const midnight = new Date(instant);
        expect(communityToday(midnight)).not.toBe(utcDate(midnight));
      }
    });

    test("follows the same date as UTC at midday", () => {
      expect(communityToday(new Date("2026-11-14T12:00:00Z"))).toBe(
        "2026-11-14",
      );
      expect(communityToday(new Date("2027-07-14T12:00:00Z"))).toBe(
        "2027-07-14",
      );
    });

    test("without an argument reads the clock at call time", () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date("2026-11-14T22:59:59Z"));
        expect(communityToday()).toBe("2026-11-14");
        vi.setSystemTime(new Date("2026-11-14T23:00:00Z"));
        expect(communityToday()).toBe(communityToday(new Date()));
        expect(communityToday()).toBe("2026-11-15");
      } finally {
        vi.useRealTimers();
      }
    });

    test("rejects an invalid Date", () => {
      expect(() => communityToday(new Date("not a date"))).toThrow(RangeError);
    });
  });

  describe("isIsoDate", () => {
    test.each(["2028-02-29", "2026-11-14", "2026-12-31", "2026-01-01"])(
      "accepts %s",
      (value) => {
        expect(isIsoDate(value)).toBe(true);
      },
    );

    test.each([
      "2027-02-29",
      "2026-02-30",
      "2026-13-01",
      "2026-00-10",
      "2026-11-00",
      "2026-1-05",
      "2026-11-14T00:00",
      " 2026-11-14",
      "2026-11-14 ",
      "",
    ])("rejects %j without throwing", (value) => {
      expect(isIsoDate(value)).toBe(false);
    });

    test("applies the century leap rules", () => {
      expect(isIsoDate("2000-02-29")).toBe(true);
      expect(isIsoDate("2100-02-29")).toBe(false);
    });
  });

  describe("addDays, daysBetween and loanLengthDays", () => {
    test.each([
      ["2028-02-28", 1, "2028-02-29"],
      ["2028-02-28", 2, "2028-03-01"],
      ["2027-02-28", 1, "2027-03-01"],
      ["2026-11-30", 1, "2026-12-01"],
      ["2026-12-31", 1, "2027-01-01"],
      ["2027-01-01", -1, "2026-12-31"],
      ["2027-03-27", 2, "2027-03-29"],
      ["2026-10-24", 2, "2026-10-26"],
      ["2026-11-14", 0, "2026-11-14"],
      ["2026-11-14", 60, "2027-01-13"],
    ])("addDays(%s, %i) is %s", (date, days, expected) => {
      expect(addDays(date, days)).toBe(expected);
      expect(daysBetween(date, expected)).toBe(days);
    });

    test("daysBetween is signed and counts leap years", () => {
      expect(daysBetween("2026-11-12", "2026-11-14")).toBe(2);
      expect(daysBetween("2026-11-14", "2026-11-12")).toBe(-2);
      expect(daysBetween("2027-01-01", "2028-01-01")).toBe(365);
      expect(daysBetween("2028-01-01", "2029-01-01")).toBe(366);
    });

    test("agrees with the UTC calendar for every day from 1998-12-31 into 2032", () => {
      const origin = "2000-01-01";
      for (let offset = -366; offset <= 11_700; offset++) {
        const expected = utcDate(new Date(Date.UTC(2000, 0, 1 + offset)));
        expect(addDays(origin, offset)).toBe(expected);
        expect(daysBetween(origin, expected)).toBe(offset);
      }
    });

    test("loanLengthDays counts both dates", () => {
      expect(loanLengthDays("2026-11-14", "2026-11-14")).toBe(1);
      expect(loanLengthDays("2026-11-12", "2026-11-14")).toBe(3);
      expect(loanLengthDays("2027-03-27", "2027-03-29")).toBe(3);
    });
  });

  describe("formatDate", () => {
    test.each([
      ["2026-11-14", "2026-11-09", "Sat 14 Nov"],
      ["2028-02-29", "2028-01-01", "Tue 29 Feb"],
      ["2027-01-05", "2026-12-20", "Tue 5 Jan 2027"],
      ["2026-09-01", "2026-11-09", "Tue 1 Sep"],
    ])("formatDate(%s, today %s) is %j", (date, today, expected) => {
      expect(formatDate(date, today)).toBe(expected);
    });

    test("names every weekday and month from the dates strings block", () => {
      const { weekdays, months } = strings.dates;
      for (let offset = 0; offset < 366; offset++) {
        const instant = new Date(Date.UTC(2028, 0, 1 + offset));
        const date = utcDate(instant);
        expect(formatDate(date, "2028-06-01")).toBe(
          `${weekdays[(instant.getUTCDay() + 6) % 7]} ${instant.getUTCDate()} ${months[instant.getUTCMonth()]}`,
        );
      }
    });
  });

  describe("formatDateRange", () => {
    test.each([
      ["2026-11-14", "2026-11-14", "2026-11-09", "Sat 14 Nov"],
      ["2026-11-12", "2026-11-14", "2026-11-09", "Thu 12 – Sat 14 Nov"],
      ["2026-11-30", "2026-12-02", "2026-11-09", "Mon 30 Nov – Wed 2 Dec"],
      ["2025-11-12", "2025-11-14", "2026-11-09", "Wed 12 – Fri 14 Nov 2025"],
      [
        "2025-11-30",
        "2025-12-02",
        "2026-11-09",
        "Sun 30 Nov 2025 – Tue 2 Dec 2025",
      ],
      ["2026-12-30", "2027-01-02", "2026-12-20", "Wed 30 Dec – Sat 2 Jan 2027"],
      ["2026-12-30", "2027-01-02", "2027-01-01", "Wed 30 Dec 2026 – Sat 2 Jan"],
      [
        "2025-11-12",
        "2026-11-14",
        "2026-11-09",
        "Wed 12 Nov 2025 – Sat 14 Nov",
      ],
    ])("%s to %s (today %s) is %j", (start, end, today, expected) => {
      expect(formatDateRange(start, end, today)).toBe(expected);
    });
  });

  describe("invalid input", () => {
    test.each([
      ["addDays with a bad date", () => addDays("2026-02-30", 1), "2026-02-30"],
      [
        "addDays with a fractional count",
        () => addDays("2026-11-14", 1.5),
        "1.5",
      ],
      ["addDays with NaN", () => addDays("2026-11-14", Number.NaN), "NaN"],
      ["addDays past year 9999", () => addDays("9999-12-31", 1), "10000-01-01"],
      [
        "daysBetween with a bad from",
        () => daysBetween("x", "2026-11-14"),
        "x",
      ],
      [
        "daysBetween with a bad to",
        () => daysBetween("2026-11-14", "2026-1-1"),
        "2026-1-1",
      ],
      [
        "loanLengthDays with end before start",
        () => loanLengthDays("2026-11-14", "2026-11-13"),
        "2026-11-13",
      ],
      [
        "formatDate with a bad date",
        () => formatDate("14 Nov", "2026-11-09"),
        "14 Nov",
      ],
      ["formatDate with a bad today", () => formatDate("2026-11-14", ""), '""'],
      [
        "formatDateRange with end before start",
        () => formatDateRange("2026-11-14", "2026-11-12", "2026-11-09"),
        "2026-11-12",
      ],
      [
        "formatDateRange with a bad today",
        () => formatDateRange("2026-11-12", "2026-11-14", "today"),
        "today",
      ],
    ])("%s throws a RangeError naming the value", (_, call, value) => {
      expect(call).toThrow(RangeError);
      expect(call).toThrow(value);
    });
  });
});
