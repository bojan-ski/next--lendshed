"use client";

import { useActionState, useEffect, useRef } from "react";
import { markLoanReturned } from "@/actions/loans";
import { announceDecision } from "@/components/loans/decision-focus";
import LoanRefusal from "@/components/loans/LoanRefusal";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import TextInput from "@/components/ui/TextInput";
import { loanActions } from "@/strings/loanActions";
import type { MarkReturnedState } from "@/types/loan";

const initialState: MarkReturnedState = {};

const AS_LENT_ERROR_ID = "asLent-error";

const choices = [
  { value: "yes", label: loanActions.asLentYes },
  { value: "no", label: loanActions.asLentNo },
] as const;

async function returnAndAnnounce(
  prev: MarkReturnedState,
  formData: FormData,
): Promise<MarkReturnedState> {
  return announceDecision(await markLoanReturned(prev, formData));
}

// The date's bounds are the loan's start and the server's community date,
// never the browser clock. No radio is pre-checked and none is `required`:
// a missing answer comes back as the app's inline error.
export default function MarkReturnedForm({
  loanId,
  minDate,
  maxDate,
}: {
  loanId: string;
  minDate: string;
  maxDate: string;
}) {
  const [state, formAction] = useActionState(returnAndAnnounce, initialState);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const asLentError = state.fieldErrors?.asLent?.[0];

  // A radio can't carry aria-invalid (the radiogroup does), so the group's
  // first radio is found by name; the date comes first when both are wrong.
  useEffect(() => {
    if (state === initialState) return;
    if (state.formError) notice.current?.focus();
    else if (state.fieldErrors?.returnedOn) {
      form.current?.querySelector<HTMLElement>("#returnedOn")?.focus();
    } else if (state.fieldErrors?.asLent) {
      form.current?.querySelector<HTMLElement>('[name="asLent"]')?.focus();
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
        id="returnedOn"
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
        role="radiogroup"
        aria-invalid={asLentError ? true : undefined}
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
      <Button type="submit" className="w-full sm:w-auto sm:self-start">
        {loanActions.markBack}
      </Button>
    </form>
  );
}
