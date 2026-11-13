import { refresh } from "next/cache";
import { loanRow, ownerLoans } from "@/__tests__/support/loan-fixtures";
import * as loanActions from "@/actions/loans";
import { getViewer } from "@/data/viewer";
import type { LoanStatus } from "@/generated/prisma/enums";
import { setFlash } from "@/lib/feedback/flash";
import type { FlashKey } from "@/strings";
import type { EffectiveLoanStatus, LoanAction } from "@/types/loan";
import type { ViewerDTO } from "@/types/viewer";

// For suites that mock `@/data/viewer` (getViewer), `next/cache`
// (nextCacheModule) and `@/lib/feedback/flash` (setFlash).

export const TRANSITIONS = {
  approveLoan: { entry: "approve", flash: "loanApproved", target: "approved" },
  declineLoan: { entry: "decline", flash: "loanDeclined", target: "declined" },
  cancelLoan: { entry: "cancel", flash: "loanCancelled", target: "cancelled" },
  markLoanOut: { entry: "hand_over", flash: "loanHandedOver", target: "out" },
  markLoanReturned: {
    entry: "mark_returned",
    flash: "loanReturned",
    target: "returned",
  },
} as const satisfies Record<
  string,
  { entry: LoanAction; flash: FlashKey; target: LoanStatus }
>;
export type Transition = keyof typeof TRANSITIONS;

export type TransitionState = {
  flash?: FlashKey;
  formError?: string;
  fieldErrors?: object;
};

// The form the loan page posts for this loan in `status`: cancel carries the
// stage the screen showed, a return is today and "as lent".
export function transitionForm(
  transition: Transition,
  id: string,
  status: EffectiveLoanStatus,
  today: string,
  overrides: Record<string, string> = {},
): FormData {
  const fields: Record<string, string> = { id };
  if (transition === "cancelLoan") {
    fields.stage = status === "requested" ? "request" : "loan";
  }
  if (transition === "markLoanReturned") {
    fields.returnedOn = today;
    fields.asLent = "yes";
  }
  const data = new FormData();
  for (const [name, value] of Object.entries({ ...fields, ...overrides })) {
    data.set(name, value);
  }
  return data;
}

export function runAs(
  viewer: ViewerDTO,
  transition: Transition,
  data: FormData,
): Promise<TransitionState> {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  return loanActions[transition]({}, data);
}

// A refusal: the expected outcome, the loan byte-identical, every other loan
// on the owner's items untouched, no refresh() and no flash.
export async function expectRefused(
  run: () => Promise<TransitionState>,
  loanId: string,
  ownerId: string,
  outcome: object = { formError: "stale" },
): Promise<void> {
  const before = await loanRow(loanId);
  const scopeBefore = await ownerLoans(ownerId);
  const state = await run();
  expect(state).toMatchObject(outcome);
  expect(state.flash).toBeUndefined();
  expect(await loanRow(loanId)).toEqual(before);
  expect(await ownerLoans(ownerId)).toEqual(scopeBefore);
  expect(refresh).not.toHaveBeenCalled();
  expect(setFlash).not.toHaveBeenCalled();
}
