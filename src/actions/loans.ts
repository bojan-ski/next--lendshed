"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  approveLoanRequest,
  cancelLoanByParty,
  closeLoanByOrganizer,
  declineLoanRequest,
  handOverLoan,
  insertLoanRequest,
  markLoanBack,
} from "@/data/loans";
import { requireOrganizer, requireViewer } from "@/lib/auth/guards";
import { addDays, communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { reportUnexpected } from "@/lib/feedback/report";
import { REQUEST_AHEAD_DAYS } from "@/lib/loans/limits";
import {
  cancelStageSchema,
  loanIdSchema,
  markReturnedSchema,
  organizerCloseSchema,
  reasonSchema,
  requestLoanSchema,
} from "@/lib/schemas/loans";
import { t } from "@/lib/text/interpolate";
import { loanActions } from "@/strings/loanActions";
import { requestForm } from "@/strings/requestForm";
import type {
  HandOverState,
  LoanDecisionState,
  MarkReturnedField,
  MarkReturnedState,
  OrganizerCloseField,
  OrganizerCloseState,
  RequestLoanField,
  RequestLoanState,
} from "@/types/loan";

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

// The decisions are submitted from /loans/[id] and stay there: success
// re-renders the page and returns its flash; a refusal keeps the notice.
export async function approveLoan(
  _prev: LoanDecisionState,
  formData: FormData,
): Promise<LoanDecisionState> {
  const viewer = await requireViewer();
  const today = communityToday();

  const parsed = loanIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };

  let outcome: Awaited<ReturnType<typeof approveLoanRequest>>;
  try {
    outcome = await approveLoanRequest(viewer.id, parsed.data.id, today);
  } catch (error) {
    reportUnexpected("approveLoan", error);
    return { formError: "unexpected" };
  }
  if (outcome !== "approved") return { formError: outcome };

  refresh();
  return { flash: "loanApproved" };
}

type ReasonParse =
  | { ok: true; id: string; reason: string | null; values: { reason: string } }
  | { ok: false; state: LoanDecisionState };

// A bad id is a stale screen; a bad reason comes back with what was typed.
function parseReason(formData: FormData): ReasonParse {
  const raw = formData.get("reason");
  const values = { reason: typeof raw === "string" ? raw : "" };
  const parsed = reasonSchema.safeParse({
    id: formData.get("id"),
    reason: values.reason,
  });
  if (parsed.success) return { ok: true, ...parsed.data, values };
  const fieldErrors = z.flattenError(parsed.error).fieldErrors;
  if (fieldErrors.id) return { ok: false, state: { formError: "stale" } };
  return {
    ok: false,
    state: { fieldErrors: { reason: fieldErrors.reason }, values },
  };
}

export async function declineLoan(
  _prev: LoanDecisionState,
  formData: FormData,
): Promise<LoanDecisionState> {
  const viewer = await requireViewer();
  const today = communityToday();

  const input = parseReason(formData);
  if (!input.ok) return input.state;

  let outcome: Awaited<ReturnType<typeof declineLoanRequest>>;
  try {
    outcome = await declineLoanRequest(
      viewer.id,
      input.id,
      input.reason,
      today,
    );
  } catch (error) {
    reportUnexpected("declineLoan", error);
    return { formError: "unexpected", values: input.values };
  }
  if (outcome !== "declined") return { formError: outcome };

  refresh();
  return { flash: "loanDeclined" };
}

export async function cancelLoan(
  _prev: LoanDecisionState,
  formData: FormData,
): Promise<LoanDecisionState> {
  const viewer = await requireViewer();
  const today = communityToday();

  // A bad stage, like a bad id, is a stale screen.
  const stage = cancelStageSchema.safeParse(formData.get("stage"));
  if (!stage.success) return { formError: "stale" };
  const input = parseReason(formData);
  if (!input.ok) return input.state;

  let outcome: Awaited<ReturnType<typeof cancelLoanByParty>>;
  try {
    outcome = await cancelLoanByParty(
      viewer.id,
      input.id,
      stage.data,
      input.reason,
      today,
    );
  } catch (error) {
    reportUnexpected("cancelLoan", error);
    return { formError: "unexpected", values: input.values };
  }
  if (outcome !== "cancelled") return { formError: outcome };

  refresh();
  return { flash: "loanCancelled" };
}

export async function markLoanOut(
  _prev: HandOverState,
  formData: FormData,
): Promise<HandOverState> {
  const viewer = await requireViewer();
  const today = communityToday();

  const parsed = loanIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };

  let outcome: Awaited<ReturnType<typeof handOverLoan>>;
  try {
    outcome = await handOverLoan(viewer.id, parsed.data.id, today);
  } catch (error) {
    reportUnexpected("markLoanOut", error);
    return { formError: "unexpected" };
  }
  if (outcome !== "handedOver") return { formError: outcome };

  refresh();
  return { flash: "loanHandedOver" };
}

const RETURN_FIELDS = [
  "returnedOn",
  "asLent",
] as const satisfies readonly MarkReturnedField[];

export async function markLoanReturned(
  _prev: MarkReturnedState,
  formData: FormData,
): Promise<MarkReturnedState> {
  const viewer = await requireViewer();
  const today = communityToday();

  const values = {} as Record<MarkReturnedField, string>;
  for (const field of RETURN_FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  const parsed = markReturnedSchema.safeParse({
    id: formData.get("id"),
    returnedOn: values.returnedOn,
    asLent: formData.get("asLent") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    if (fieldErrors.id) return { formError: "stale" };
    return {
      fieldErrors: Object.fromEntries(
        RETURN_FIELDS.flatMap((field) =>
          fieldErrors[field] ? [[field, fieldErrors[field]]] : [],
        ),
      ),
      values,
    };
  }
  if (parsed.data.returnedOn > today) {
    return {
      fieldErrors: { returnedOn: [loanActions.returnedOnAfterToday] },
      values,
    };
  }

  let outcome: Awaited<ReturnType<typeof markLoanBack>>;
  try {
    outcome = await markLoanBack(viewer.id, parsed.data, today);
  } catch (error) {
    reportUnexpected("markLoanReturned", error);
    return { formError: "unexpected", values };
  }
  if (outcome === "beforeStart") {
    return {
      fieldErrors: { returnedOn: [loanActions.returnedOnBeforeStart] },
      values,
    };
  }
  if (outcome !== "returned") return { formError: outcome };

  refresh();
  return { flash: "loanReturned" };
}

const CLOSE_FIELDS = [
  "returnedOn",
  "asLent",
  "note",
] as const satisfies readonly OrganizerCloseField[];

// A non-party organizer ends an out loan the owner can't mark back (OQ-22);
// the transaction re-checks the actor and the loan.
export async function closeLoanAsOrganizer(
  _prev: OrganizerCloseState,
  formData: FormData,
): Promise<OrganizerCloseState> {
  const viewer = await requireOrganizer();
  const today = communityToday();

  const values = {} as Record<OrganizerCloseField, string>;
  for (const field of CLOSE_FIELDS) {
    const value = formData.get(field);
    values[field] = typeof value === "string" ? value : "";
  }
  const parsed = organizerCloseSchema.safeParse({
    id: formData.get("id"),
    returnedOn: values.returnedOn,
    asLent: formData.get("asLent") ?? undefined,
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    const fieldErrors = z.flattenError(parsed.error).fieldErrors;
    if (fieldErrors.id) return { formError: "stale" };
    return {
      fieldErrors: Object.fromEntries(
        CLOSE_FIELDS.flatMap((field) =>
          fieldErrors[field] ? [[field, fieldErrors[field]]] : [],
        ),
      ),
      values,
    };
  }
  if (parsed.data.returnedOn > today) {
    return {
      fieldErrors: { returnedOn: [loanActions.returnedOnAfterToday] },
      values,
    };
  }

  let outcome: Awaited<ReturnType<typeof closeLoanByOrganizer>>;
  try {
    outcome = await closeLoanByOrganizer(viewer.id, parsed.data, today);
  } catch (error) {
    reportUnexpected("closeLoanAsOrganizer", error);
    return { formError: "unexpected", values };
  }
  if (outcome === "beforeStart") {
    return {
      fieldErrors: { returnedOn: [loanActions.returnedOnBeforeStart] },
      values,
    };
  }
  if (outcome !== "closed") return { formError: outcome };

  refresh();
  return { flash: "loanClosed" };
}
