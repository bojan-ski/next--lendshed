import type { Ref } from "react";
import Notice from "@/components/ui/Notice";
import { errors } from "@/strings/errors";
import { requestForm } from "@/strings/requestForm";
import type { LoanDecisionState } from "@/types/loan";

const messages = {
  stale: errors.stale,
  datesTaken: requestForm.datesTaken,
  unexpected: errors.actionFailed,
} satisfies Record<NonNullable<LoanDecisionState["formError"]>, string>;

// Focus moves here after a refused decision, so it is not also an alert.
export default function LoanRefusal({
  formError,
  ref,
}: {
  formError: NonNullable<LoanDecisionState["formError"]>;
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
