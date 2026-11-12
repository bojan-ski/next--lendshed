import { z } from "zod";
import { t } from "@/lib/text/interpolate";
import { requestForm } from "@/strings/requestForm";
import { LOAN_MESSAGE_MAX, requestLoanSchema } from "./loans";

const valid = {
  itemId: "item-1",
  startDate: "2030-06-20",
  endDate: "2030-06-22",
  message: "Saturday?",
};

const errorsOf = (input: Record<string, unknown>) => {
  const parsed = requestLoanSchema.safeParse(input);
  return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
};

describe("requestLoanSchema", () => {
  test("valid input parses, the message trimmed", () => {
    expect(
      requestLoanSchema.parse({ ...valid, message: "  Saturday?  " }),
    ).toEqual(valid);
  });

  test("an empty or whitespace-only message is null; a missing one too", () => {
    expect(
      requestLoanSchema.parse({ ...valid, message: "   \r\n " }).message,
    ).toBeNull();
    expect(
      requestLoanSchema.parse({ ...valid, message: undefined }).message,
    ).toBeNull();
  });

  test("500 characters pass; 501 fail on message", () => {
    expect(
      errorsOf({ ...valid, message: "x".repeat(LOAN_MESSAGE_MAX) }),
    ).toEqual({});
    expect(
      errorsOf({ ...valid, message: "x".repeat(LOAN_MESSAGE_MAX + 1) }),
    ).toEqual({
      message: [t(requestForm.messageTooLong, { max: LOAN_MESSAGE_MAX })],
    });
  });

  test("line breaks count once: CRLF is normalised before the limit", () => {
    const text = "ab\r\n".repeat(LOAN_MESSAGE_MAX / 3).slice(0, -2);
    expect(errorsOf({ ...valid, message: text })).toEqual({});
  });

  test.each([
    ["startDate", "2030-02-30"],
    ["startDate", "20-06-2030"],
    ["endDate", "soon"],
  ])("a non-ISO %s (%s) is a field error on it", (field, value) => {
    expect(errorsOf({ ...valid, [field]: value })).toEqual({
      [field]: [requestForm.dateInvalid],
    });
  });

  test("an end before the start is an error on endDate; the same day is fine", () => {
    expect(errorsOf({ ...valid, endDate: "2030-06-19" })).toEqual({
      endDate: [requestForm.endBeforeStart],
    });
    expect(errorsOf({ ...valid, endDate: valid.startDate })).toEqual({});
  });

  test("the end-before-start check also runs beside a message error", () => {
    expect(
      errorsOf({
        ...valid,
        endDate: "2030-06-19",
        message: "x".repeat(LOAN_MESSAGE_MAX + 1),
      }),
    ).toHaveProperty("endDate", [requestForm.endBeforeStart]);
  });

  test("an empty itemId is an itemId issue (the action reports it as stale)", () => {
    expect(Object.keys(errorsOf({ ...valid, itemId: "" }))).toEqual(["itemId"]);
  });

  test("server-controlled fields are dropped", () => {
    const parsed = requestLoanSchema.parse({
      ...valid,
      borrowerId: "someone",
      status: "approved",
      ownerSeenAt: "2030-01-01",
    });
    expect(Object.keys(parsed).sort()).toEqual([
      "endDate",
      "itemId",
      "message",
      "startDate",
    ]);
  });
});
