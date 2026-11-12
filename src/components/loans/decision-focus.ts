import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { LOAN_HEADING_ID } from "@/components/loans/ids";
import { showToast } from "@/lib/feedback/toast";
import type { LoanDecisionState } from "@/types/loan";

// A decision re-renders the page without its controls in the same commit as
// the new state, so an effect would never run: announce before it lands.
export function announceDecision(next: LoanDecisionState): LoanDecisionState {
  if (next.flash) {
    showToast(next.flash);
    document.getElementById(LOAN_HEADING_ID)?.focus();
  }
  return next;
}

// A refused submit focuses its notice (rules/feedback.md).
export function useRefusalFocus(
  state: LoanDecisionState,
  notice: RefObject<HTMLDivElement | null>,
) {
  useEffect(() => {
    if (state.formError) notice.current?.focus();
  }, [state, notice]);
}

// The confirmation step: opening it focuses its confirm button, "Keep it"
// returns focus to the trigger, a reason error focuses the textarea.
export function useConfirmStep(state: LoanDecisionState) {
  const [confirming, setConfirming] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const reason = useRef<HTMLTextAreaElement>(null);
  const kept = useRef(false);

  useEffect(() => {
    if (confirming) confirm.current?.focus();
    else if (kept.current) {
      kept.current = false;
      trigger.current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    if (state.fieldErrors?.reason) reason.current?.focus();
  }, [state]);

  const open = useCallback(() => setConfirming(true), []);
  const keep = useCallback(() => {
    kept.current = true;
    setConfirming(false);
  }, []);

  return {
    confirming,
    triggerRef: trigger,
    confirmRef: confirm,
    reasonRef: reason,
    open,
    keep,
  };
}
