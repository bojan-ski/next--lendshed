"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { insertLoanRequest } from "@/data/loans";
import { requireViewer } from "@/lib/auth/guards";
import { addDays, communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { reportUnexpected } from "@/lib/feedback/report";
import { REQUEST_AHEAD_DAYS } from "@/lib/loans/limits";
import { requestLoanSchema } from "@/lib/schemas/loans";
import { t } from "@/lib/text/interpolate";
import { requestForm } from "@/strings/requestForm";
import type { RequestLoanField, RequestLoanState } from "@/types/loan";

const REQUEST_FIELDS = [
  "startDate",
  "endDate",
  "message",
] as const satisfies readonly RequestLoanField[];

// The raw text of the three fields: React resets the form after every submit.
function echoRequest(formData: FormData): Record<RequestLoanField, string> {
  const values = {} as Record<RequestLoanField, string>;
  for (const field of REQUEST_FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  return values;
}

// Every refusal is decided here or in the transaction; success redirects to
// the new loan, a different page from the item, so the Toaster sees the flash.
export async function requestLoan(
  _prev: RequestLoanState,
  formData: FormData,
): Promise<RequestLoanState> {
  const viewer = await requireViewer();
  const values = echoRequest(formData);

  const parsed = requestLoanSchema.safeParse({
    ...values,
    itemId: formData.get("itemId"),
  });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    if (fieldErrors.itemId) return { formError: "stale", values };
    return {
      fieldErrors: Object.fromEntries(
        REQUEST_FIELDS.flatMap((field) =>
          fieldErrors[field] ? [[field, fieldErrors[field]]] : [],
        ),
      ),
      values,
    };
  }

  const today = communityToday();
  const { startDate } = parsed.data;
  if (startDate < today || startDate > addDays(today, REQUEST_AHEAD_DAYS)) {
    return {
      fieldErrors: {
        startDate: [
          t(requestForm.startOutOfWindow, { days: REQUEST_AHEAD_DAYS }),
        ],
      },
      values,
    };
  }

  let outcome: Awaited<ReturnType<typeof insertLoanRequest>>;
  try {
    outcome = await insertLoanRequest(viewer.id, parsed.data, today);
  } catch (error) {
    reportUnexpected("requestLoan", error);
    return { formError: "unexpected", values };
  }
  if (outcome.kind === "tooLong") {
    return {
      fieldErrors: {
        endDate: [t(requestForm.tooLong, { max: outcome.maxLoanDays })],
      },
      values,
    };
  }
  if (outcome.kind !== "created") return { formError: outcome.kind, values };

  await setFlash("requestSent");
  redirect(`/loans/${outcome.id}`);
}
