import { z } from "zod";
import { isIsoDate } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { loanActions } from "@/strings/loanActions";
import { requestForm } from "@/strings/requestForm";

export const LOAN_MESSAGE_MAX = 500;
// OQ-29 (assumed).
export const LOAN_REASON_MAX = 300;

// Browsers submit textarea line breaks as CRLF: normalise before counting.
function optionalText(max: number, tooLong: string) {
  return z
    .string()
    .nullish()
    .transform((text) => (text ?? "").replace(/\r\n?/g, "\n"))
    .pipe(
      z
        .string()
        .trim()
        .max(max, { error: t(tooLong, { max }) }),
    )
    .transform((text) => text || null);
}

const isoDate = z
  .string({ error: requestForm.dateInvalid })
  .refine(isIsoDate, { error: requestForm.dateInvalid });

const loanDates = z.object({ startDate: isoDate, endDate: isoDate });

// Today- and item-dependent rules are checked in the action and the data layer.
// A bad itemId is a stale screen, never a field error.
export const requestLoanSchema = z
  .object({
    itemId: z.string().min(1),
    ...loanDates.shape,
    message: optionalText(LOAN_MESSAGE_MAX, requestForm.messageTooLong),
  })
  .refine((input) => input.endDate >= input.startDate, {
    error: requestForm.endBeforeStart,
    path: ["endDate"],
    // Only once both dates are valid, whatever else failed.
    when: (payload) => loanDates.safeParse(payload.value).success,
  });

export type RequestLoanInput = z.infer<typeof requestLoanSchema>;

// A bad id is a stale screen, never a field error.
export const loanIdSchema = z.object({ id: z.string().min(1) });

export const reasonSchema = z.object({
  id: loanIdSchema.shape.id,
  reason: optionalText(LOAN_REASON_MAX, loanActions.reasonTooLong),
});

// What the cancel form showed; a mismatch with the loan now is a stale screen.
export const cancelStageSchema = z.enum(["request", "loan"]);

// `unknown` is the organizer close's answer, never the owner's. The date's
// bounds depend on today and the loan, so the action and the data layer
// check them.
export const markReturnedSchema = z.object({
  id: loanIdSchema.shape.id,
  returnedOn: z
    .string({ error: loanActions.returnedOnInvalid })
    .refine(isIsoDate, { error: loanActions.returnedOnInvalid }),
  asLent: z.enum(["yes", "no"], { error: loanActions.asLentRequired }),
});

export type MarkReturnedInput = z.infer<typeof markReturnedSchema>;

// A missing or unknown tab is absent, never an error; the section picks one.
export const myLoansQuerySchema = z.object({
  tab: z.enum(["borrowing", "lending"]).optional().catch(undefined),
});

export type MyLoansQuery = z.infer<typeof myLoansQuerySchema>;
