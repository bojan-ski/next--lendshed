import { z } from "zod";
import { t } from "@/lib/text/interpolate";
import { loanActions } from "@/strings/loanActions";
import { requestForm } from "@/strings/requestForm";
import {
  cancelStageSchema,
  LOAN_MESSAGE_MAX,
  LOAN_REASON_MAX,
  loanIdSchema,
  myLoansQuerySchema,
  reasonSchema,
  requestLoanSchema,
} from "./loans";

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

describe("reasonSchema", () => {
  const reasonErrors = (reason: unknown) => {
    const parsed = reasonSchema.safeParse({ id: "loan-1", reason });
    return parsed.success ? {} : z.flattenError(parsed.error).fieldErrors;
  };

  test("the reason is trimmed; empty, whitespace-only or missing is null", () => {
    expect(reasonSchema.parse({ id: "loan-1", reason: "  Away  " })).toEqual({
      id: "loan-1",
      reason: "Away",
    });
    for (const reason of ["", "  \r\n ", undefined, null]) {
      expect(reasonSchema.parse({ id: "loan-1", reason }).reason).toBeNull();
    }
  });

  test("300 characters pass; 301 fail on reason with the limit in the message", () => {
    expect(reasonErrors("x".repeat(LOAN_REASON_MAX))).toEqual({});
    expect(reasonErrors("x".repeat(LOAN_REASON_MAX + 1))).toEqual({
      reason: [t(loanActions.reasonTooLong, { max: LOAN_REASON_MAX })],
    });
  });

  test("a CRLF line break counts as one character", () => {
    // Mid-text, so the trim can't remove it: 300 after normalising, 301 before.
    const middle = `${"x".repeat(150)}\r\n${"x".repeat(LOAN_REASON_MAX - 151)}`;
    expect(reasonErrors(middle)).toEqual({});
  });

  test("a missing or empty id fails on id only", () => {
    for (const id of [undefined, ""]) {
      const parsed = reasonSchema.safeParse({ id, reason: "Away" });
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(Object.keys(z.flattenError(parsed.error).fieldErrors)).toEqual([
          "id",
        ]);
      }
    }
  });

  test("the schema carries no server-controlled field", () => {
    expect(Object.keys(reasonSchema.shape)).toEqual(["id", "reason"]);
    expect(Object.keys(loanIdSchema.shape)).toEqual(["id"]);
  });
});

describe("cancelStageSchema", () => {
  test("accepts request and loan only", () => {
    expect(cancelStageSchema.parse("request")).toBe("request");
    expect(cancelStageSchema.parse("loan")).toBe("loan");
    for (const stage of ["out", "", null, undefined]) {
      expect(cancelStageSchema.safeParse(stage).success).toBe(false);
    }
  });
});

describe("myLoansQuerySchema", () => {
  test("borrowing and lending pass through", () => {
    expect(myLoansQuerySchema.parse({ tab: "borrowing" })).toEqual({
      tab: "borrowing",
    });
    expect(myLoansQuerySchema.parse({ tab: "lending" })).toEqual({
      tab: "lending",
    });
  });

  test("missing, empty, repeated or unknown → absent, never an error", () => {
    for (const tab of [
      undefined,
      "",
      ["lending", "borrowing"],
      "both",
      "LENDING",
    ]) {
      expect(myLoansQuerySchema.parse({ tab }).tab).toBeUndefined();
    }
    expect(myLoansQuerySchema.parse({}).tab).toBeUndefined();
  });

  test("other params are dropped", () => {
    expect(myLoansQuerySchema.parse({ tab: "lending", page: "2" })).toEqual({
      tab: "lending",
    });
  });
});
