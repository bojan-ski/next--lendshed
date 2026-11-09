import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import type { LoanCardDTO, LoanStatus } from "@/types/loan";
import { communityToday } from "./dates";
import { effectiveStatus } from "./effective-status";

const TODAY = "2026-11-14";
const BEFORE = "2026-11-13";
const AFTER = "2026-11-15";

describe.each(TEST_ZONES)("effectiveStatus with process TZ=%s", (zone) => {
  useProcessTimeZone(zone);

  test.each([
    ["requested", BEFORE, AFTER, "expired"],
    ["requested", TODAY, AFTER, "requested"],
    ["requested", AFTER, AFTER, "requested"],
    ["approved", BEFORE, BEFORE, "lapsed"],
    ["approved", BEFORE, TODAY, "approved"],
    ["approved", BEFORE, AFTER, "approved"],
    ["approved", AFTER, AFTER, "approved"],
    ["out", BEFORE, BEFORE, "overdue"],
    ["out", BEFORE, TODAY, "out"],
    ["out", BEFORE, AFTER, "out"],
  ] as const)(
    "stored %s from %s to %s is %s",
    (status, startDate, endDate, expected) => {
      expect(effectiveStatus({ status, startDate, endDate }, TODAY)).toBe(
        expected,
      );
    },
  );

  const finalStatuses: LoanStatus[] = [
    "expired",
    "lapsed",
    "returned",
    "declined",
    "cancelled",
  ];
  const datePairs = [
    [BEFORE, BEFORE],
    [TODAY, TODAY],
    [AFTER, AFTER],
    [BEFORE, AFTER],
  ];

  test.each(finalStatuses)("stored %s never changes", (status) => {
    for (const [startDate, endDate] of datePairs) {
      expect(effectiveStatus({ status, startDate, endDate }, TODAY)).toBe(
        status,
      );
    }
  });

  test("a request flips to expired at local midnight, not UTC midnight", () => {
    const loan = {
      status: "requested" as const,
      startDate: "2026-11-14",
      endDate: "2026-11-16",
    };
    const before = communityToday(new Date("2026-11-14T22:59:59Z"));
    const after = communityToday(new Date("2026-11-14T23:00:00Z"));
    expect(effectiveStatus(loan, before)).toBe("requested");
    expect(effectiveStatus(loan, after)).toBe("expired");
  });

  test("refuses overdue as a stored status", () => {
    expect(() =>
      effectiveStatus(
        // @ts-expect-error overdue is derived, never stored
        { status: "overdue", startDate: BEFORE, endDate: BEFORE },
        TODAY,
      ),
    ).toThrow(RangeError);
  });

  test("accepts DTO-shaped rows and ignores their other fields", () => {
    const card: LoanCardDTO = {
      id: "loan-1",
      side: "borrowing",
      item: { id: "item-1", title: "Ladder", photo: null },
      otherPartyName: "Ruth K.",
      startDate: BEFORE,
      endDate: BEFORE,
      status: "out",
      group: "active",
      needsYou: null,
      changed: false,
    };
    const row = { ...card, status: "out" as const, returnedOn: AFTER };
    expect(effectiveStatus(row, TODAY)).toBe("overdue");
  });
});
