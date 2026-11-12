import type { ReactNode, Ref } from "react";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import TextArea from "@/components/ui/TextArea";
import { LOAN_REASON_MAX } from "@/lib/schemas/loans";
import { loanActions } from "@/strings/loanActions";
import type { LoanDecisionState } from "@/types/loan";

// The question, an optional reason the other party will read, then the
// confirm button (described by the question) and "Keep it".
export default function ReasonConfirmStep({
  name,
  loanId,
  action,
  state,
  question,
  hint,
  confirmLabel,
  failure,
  confirmRef,
  reasonRef,
  onKeep,
  children,
}: {
  name: string;
  loanId: string;
  action: (formData: FormData) => void;
  state: LoanDecisionState;
  question: string;
  hint: string;
  confirmLabel: string;
  failure: ReactNode;
  confirmRef: Ref<HTMLButtonElement>;
  reasonRef: Ref<HTMLTextAreaElement>;
  onKeep: () => void;
  // Extra hidden fields the action needs.
  children?: ReactNode;
}) {
  const questionId = `${name}-question`;
  return (
    <form action={action} className="flex flex-col gap-3">
      {failure}
      <p id={questionId} className="text-sm text-muted wrap-break-word">
        {question}
      </p>
      <input type="hidden" name="id" value={loanId} />
      {children}
      <Field
        id={`${name}-reason`}
        label={loanActions.reasonLabel}
        hint={hint}
        errors={state.fieldErrors?.reason}
      >
        {(control) => (
          <TextArea
            {...control}
            ref={reasonRef}
            name="reason"
            rows={3}
            maxLength={LOAN_REASON_MAX}
            defaultValue={state.values?.reason}
            className="text-base"
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button
          ref={confirmRef}
          type="submit"
          variant="outline"
          aria-describedby={questionId}
          className="max-sm:flex-1"
        >
          {confirmLabel}
        </Button>
        <Button variant="outline" className="max-sm:flex-1" onClick={onKeep}>
          {loanActions.keep}
        </Button>
      </div>
    </form>
  );
}
