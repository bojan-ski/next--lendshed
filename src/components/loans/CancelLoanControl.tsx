"use client";

import { useActionState, useRef } from "react";
import { cancelLoan } from "@/actions/loans";
import {
  announceDecision,
  useConfirmStep,
  useRefusalFocus,
} from "@/components/loans/decision-focus";
import LoanRefusal from "@/components/loans/LoanRefusal";
import ReasonConfirmStep from "@/components/loans/ReasonConfirmStep";
import Button from "@/components/ui/Button";
import { loanActions } from "@/strings/loanActions";
import type { CancelStage, LoanDecisionState } from "@/types/loan";

const initialState: LoanDecisionState = {};

const labels = {
  request: {
    trigger: loanActions.cancelRequest,
    question: loanActions.cancelRequestQuestion,
    confirm: loanActions.cancelRequestConfirm,
  },
  loan: {
    trigger: loanActions.cancelLoan,
    question: loanActions.cancelLoanQuestion,
    confirm: loanActions.cancelLoanConfirm,
  },
} as const;

async function cancelAndAnnounce(
  prev: LoanDecisionState,
  formData: FormData,
): Promise<LoanDecisionState> {
  return announceDecision(await cancelLoan(prev, formData));
}

// Either party calls off a request or an approved loan, after a
// confirmation step with an optional reason.
export default function CancelLoanControl({
  loanId,
  stage,
}: {
  loanId: string;
  stage: CancelStage;
}) {
  const [state, formAction] = useActionState(cancelAndAnnounce, initialState);
  const { confirming, triggerRef, confirmRef, reasonRef, open, keep } =
    useConfirmStep(state);
  const notice = useRef<HTMLDivElement>(null);
  useRefusalFocus(state, notice);
  const label = labels[stage];

  // Stale: the page is out of date, so there is nothing to retry.
  if (state.formError === "stale") {
    return <LoanRefusal ref={notice} formError="stale" />;
  }

  const failure = state.formError && (
    <LoanRefusal ref={notice} formError={state.formError} />
  );

  if (confirming) {
    return (
      <ReasonConfirmStep
        name="cancel"
        loanId={loanId}
        action={formAction}
        state={state}
        question={label.question}
        hint={loanActions.reasonHintOther}
        confirmLabel={label.confirm}
        failure={failure}
        confirmRef={confirmRef}
        reasonRef={reasonRef}
        onKeep={keep}
      >
        <input type="hidden" name="stage" value={stage} />
      </ReasonConfirmStep>
    );
  }

  return (
    <Button
      ref={triggerRef}
      variant="outline"
      className="w-full sm:w-auto sm:self-start"
      onClick={open}
    >
      {label.trigger}
    </Button>
  );
}
