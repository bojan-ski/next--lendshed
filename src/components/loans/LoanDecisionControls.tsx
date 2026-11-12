"use client";

import { useActionState, useRef } from "react";
import { approveLoan, declineLoan } from "@/actions/loans";
import {
  announceDecision,
  useConfirmStep,
  useRefusalFocus,
} from "@/components/loans/decision-focus";
import LoanRefusal from "@/components/loans/LoanRefusal";
import ReasonConfirmStep from "@/components/loans/ReasonConfirmStep";
import Button from "@/components/ui/Button";
import { loanActions } from "@/strings/loanActions";
import type { LoanDecisionState } from "@/types/loan";

const initialState: LoanDecisionState = {};

async function approveAndAnnounce(
  prev: LoanDecisionState,
  formData: FormData,
): Promise<LoanDecisionState> {
  return announceDecision(await approveLoan(prev, formData));
}

async function declineAndAnnounce(
  prev: LoanDecisionState,
  formData: FormData,
): Promise<LoanDecisionState> {
  return announceDecision(await declineLoan(prev, formData));
}

// The owner's answer to a request: Approve at once (only while the item is
// listed and the borrower still exists), or Decline through a confirmation
// step with an optional reason.
export default function LoanDecisionControls({
  loanId,
  canApprove,
}: {
  loanId: string;
  canApprove: boolean;
}) {
  const [approveState, approveAction] = useActionState(
    approveAndAnnounce,
    initialState,
  );
  const [declineState, declineAction] = useActionState(
    declineAndAnnounce,
    initialState,
  );
  const { confirming, triggerRef, confirmRef, reasonRef, open, keep } =
    useConfirmStep(declineState);
  const notice = useRef<HTMLDivElement>(null);
  useRefusalFocus(approveState, notice);
  useRefusalFocus(declineState, notice);

  const shown = confirming ? declineState : approveState;
  const failure = shown.formError && (
    <LoanRefusal ref={notice} formError={shown.formError} />
  );

  // Stale or taken: the page is out of date, so there is nothing to retry.
  for (const state of [approveState, declineState]) {
    if (state.formError === "stale" || state.formError === "datesTaken") {
      return <LoanRefusal ref={notice} formError={state.formError} />;
    }
  }

  if (confirming) {
    return (
      <ReasonConfirmStep
        name="decline"
        loanId={loanId}
        action={declineAction}
        state={declineState}
        question={loanActions.declineQuestion}
        hint={loanActions.reasonHintBorrower}
        confirmLabel={loanActions.declineConfirm}
        failure={failure}
        confirmRef={confirmRef}
        reasonRef={reasonRef}
        onKeep={keep}
      />
    );
  }

  return (
    <form action={approveAction} className="flex flex-col gap-3">
      {failure}
      <input type="hidden" name="id" value={loanId} />
      <div className="flex gap-2">
        {canApprove && (
          <Button type="submit" className="max-sm:flex-1">
            {loanActions.approve}
          </Button>
        )}
        <Button
          ref={triggerRef}
          variant="outline"
          className="max-sm:flex-1"
          onClick={open}
        >
          {loanActions.decline}
        </Button>
      </div>
    </form>
  );
}
