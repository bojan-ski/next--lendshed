"use client";

import { useActionState, useEffect, useRef } from "react";
import { closeLoanAsOrganizer } from "@/actions/loans";
import { announceDecision } from "@/components/loans/decision-focus";
import LoanRefusal from "@/components/loans/LoanRefusal";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { LOAN_REASON_MAX } from "@/lib/schemas/loans";
import { loanActions } from "@/strings/loanActions";
import type { OrganizerCloseState } from "@/types/loan";

const initialState: OrganizerCloseState = {};

const AS_LENT_ERROR_ID = "close-asLent-error";

const choices = [
  { value: "yes", label: loanActions.asLentYes },
  { value: "no", label: loanActions.asLentNo },
  { value: "unknown", label: loanActions.asLentUnknown },
] as const;

async function closeAndAnnounce(
  prev: OrganizerCloseState,
  formData: FormData,
): Promise<OrganizerCloseState> {
  return announceDecision(await closeLoanAsOrganizer(prev, formData));
}

// MarkReturnedForm plus a third answer and the required note. The bounds are
// the loan's start and the server's community date; no radio is pre-checked.
export default function OrganizerCloseForm({
  loanId,
  minDate,
  maxDate,
}: {
  loanId: string;
  minDate: string;
  maxDate: string;
}) {
  const [state, formAction] = useActionState(closeAndAnnounce, initialState);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const asLentError = state.fieldErrors?.asLent?.[0];

  // In form order; the radio group's first radio is found by name.
  useEffect(() => {
    if (state === initialState) return;
    if (state.formError) notice.current?.focus();
    else if (state.fieldErrors?.returnedOn) {
      form.current?.querySelector<HTMLElement>("#close-returnedOn")?.focus();
    } else if (state.fieldErrors?.asLent) {
      form.current?.querySelector<HTMLElement>('[name="asLent"]')?.focus();
    } else if (state.fieldErrors?.note) {
      form.current?.querySelector<HTMLElement>("#close-note")?.focus();
    }
  }, [state]);

  if (state.formError === "stale") {
    return <LoanRefusal ref={notice} formError="stale" />;
  }

  return (
    <form
      ref={form}
      action={formAction}
      noValidate
      className="flex flex-col gap-4"
    >
      {state.formError && (
        <LoanRefusal ref={notice} formError={state.formError} />
      )}
      <input type="hidden" name="id" value={loanId} />
      <Field
        id="close-returnedOn"
        label={loanActions.backOn}
        errors={state.fieldErrors?.returnedOn}
      >
        {(control) => (
          <TextInput
            {...control}
            type="date"
            name="returnedOn"
            min={minDate}
            max={maxDate}
            defaultValue={state.values?.returnedOn ?? maxDate}
          />
        )}
      </Field>
      <fieldset
        aria-describedby={asLentError ? AS_LENT_ERROR_ID : undefined}
        className="flex flex-col gap-1.5"
      >
        <legend className="mb-1.5 font-bold">{loanActions.asLentLegend}</legend>
        <div className="flex flex-col sm:flex-row sm:gap-6">
          {choices.map((choice) => (
            <label
              key={choice.value}
              className="flex min-h-11 cursor-pointer items-center gap-3"
            >
              <input
                type="radio"
                name="asLent"
                value={choice.value}
                defaultChecked={state.values?.asLent === choice.value}
                className="size-5 shrink-0 accent-accent"
              />
              {choice.label}
            </label>
          ))}
        </div>
        {asLentError && (
          <p id={AS_LENT_ERROR_ID} className="text-base">
            {asLentError}
          </p>
        )}
      </fieldset>
      <Field
        id="close-note"
        label={loanActions.noteLabel}
        hint={loanActions.noteHint}
        errors={state.fieldErrors?.note}
      >
        {(control) => (
          <TextArea
            {...control}
            name="note"
            rows={3}
            maxLength={LOAN_REASON_MAX}
            defaultValue={state.values?.note}
            className="text-base"
          />
        )}
      </Field>
      <Button type="submit" className="w-full sm:w-auto sm:self-start">
        {loanActions.closeLoan}
      </Button>
    </form>
  );
}
