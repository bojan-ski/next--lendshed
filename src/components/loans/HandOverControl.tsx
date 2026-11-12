"use client";

import { useActionState, useRef } from "react";
import { markLoanOut } from "@/actions/loans";
import {
  announceDecision,
  useRefusalFocus,
} from "@/components/loans/decision-focus";
import LoanRefusal from "@/components/loans/LoanRefusal";
import Button from "@/components/ui/Button";
import { loanActions } from "@/strings/loanActions";
import type { HandOverState } from "@/types/loan";

const initialState: HandOverState = {};

async function handOverAndAnnounce(
  prev: HandOverState,
  formData: FormData,
): Promise<HandOverState> {
  return announceDecision(await markLoanOut(prev, formData));
}

// Not destructive, so no confirmation step. A stale screen or an item still
// out leaves nothing to retry here; an unexpected failure keeps the button.
export default function HandOverControl({ loanId }: { loanId: string }) {
  const [state, formAction] = useActionState(handOverAndAnnounce, initialState);
  const notice = useRef<HTMLDivElement>(null);
  useRefusalFocus(state, notice);

  if (state.formError === "stale" || state.formError === "stillOut") {
    return <LoanRefusal ref={notice} formError={state.formError} />;
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {state.formError && (
        <LoanRefusal ref={notice} formError={state.formError} />
      )}
      <input type="hidden" name="id" value={loanId} />
      <Button type="submit" className="w-full sm:w-auto">
        {loanActions.handOver}
      </Button>
    </form>
  );
}
