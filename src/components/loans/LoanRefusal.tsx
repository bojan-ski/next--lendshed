import type { Ref } from "react";
import Notice from "@/components/ui/Notice";
import { errors } from "@/strings/errors";
import { loanActions } from "@/strings/loanActions";
import { requestForm } from "@/strings/requestForm";
import type { HandOverState, LoanDecisionState } from "@/types/loan";

type LoanRefusalError =
  | NonNullable<LoanDecisionState["formError"]>
  | NonNullable<HandOverState["formError"]>;

const messages = {
  stale: errors.stale,
  datesTaken: requestForm.datesTaken,
  stillOut: loanActions.notBack,
  unexpected: errors.actionFailed,
} satisfies Record<LoanRefusalError, string>;

// Focus moves here after a refused decision, so it is not also an alert.
export default function LoanRefusal({
  formError,
  ref,
}: {
  formError: LoanRefusalError;
  ref: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} tabIndex={-1}>
      <Notice tone="error" alert={false}>
        {messages[formError]}
      </Notice>
    </div>
  );
}
