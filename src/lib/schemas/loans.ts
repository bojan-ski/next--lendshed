import { z } from "zod";
import { isIsoDate } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { requestForm } from "@/strings/requestForm";

export const LOAN_MESSAGE_MAX = 500;

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
    // Browsers submit textarea line breaks as CRLF: normalise before counting.
    message: z
      .string()
      .nullish()
      .transform((text) => (text ?? "").replace(/\r\n?/g, "\n"))
      .pipe(
        z
          .string()
          .trim()
          .max(LOAN_MESSAGE_MAX, {
            error: t(requestForm.messageTooLong, { max: LOAN_MESSAGE_MAX }),
          }),
      )
      .transform((text) => text || null),
  })
  .refine((input) => input.endDate >= input.startDate, {
    error: requestForm.endBeforeStart,
    path: ["endDate"],
    // Only once both dates are valid, whatever else failed.
    when: (payload) => loanDates.safeParse(payload.value).success,
  });

export type RequestLoanInput = z.infer<typeof requestLoanSchema>;
