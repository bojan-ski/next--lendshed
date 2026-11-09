import { strings } from "@/strings";
import { freeToday, itemState, loanStatus, memberStatus } from "./status";

const labels = (map: Record<string, { label: string }>) =>
  Object.fromEntries(
    Object.entries(map).map(([key, style]) => [key, style.label]),
  );

describe("status labels come from the strings module", () => {
  test("loan statuses", () => {
    expect(labels(loanStatus)).toEqual(strings.status.loan);
  });

  test("item states", () => {
    expect(labels(itemState)).toEqual(strings.status.item);
  });

  test("member statuses", () => {
    expect(labels(memberStatus)).toEqual(strings.status.member);
  });

  test("Free today", () => {
    expect(freeToday.label).toBe(strings.status.freeToday);
  });
});
