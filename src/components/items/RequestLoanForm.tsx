"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { requestLoan } from "@/actions/loans";
import RequestLengthLine from "@/components/items/RequestLengthLine";
import RequestRefusal from "@/components/items/RequestRefusal";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import TextArea from "@/components/ui/TextArea";
import TextInput from "@/components/ui/TextInput";
import { isIsoDate, loanLengthDays } from "@/lib/dates/dates";
import { LOAN_MESSAGE_MAX } from "@/lib/schemas/loans";
import { t } from "@/lib/text/interpolate";
import { requestForm } from "@/strings/requestForm";
import type { RequestLoanState } from "@/types/loan";

// Only these reach the browser, never the item DTO. The date bounds come from
// the server's community date, never the browser clock.
type RequestLoanFormProps = {
  itemId: string;
  ownerName: string;
  maxLoanDays: number;
  minStart: string;
  maxStart: string;
};

const LENGTH_ID = "request-length";

const initialState: RequestLoanState = {};

function lengthOf(start: string, end: string): number | null {
  if (!isIsoDate(start) || !isIsoDate(end) || end < start) return null;
  return loanLengthDays(start, end);
}

// A refused submit resets the form, so the typed values come back from state.
export default function RequestLoanForm({
  itemId,
  ownerName,
  maxLoanDays,
  minStart,
  maxStart,
}: RequestLoanFormProps) {
  const [state, formAction] = useActionState(requestLoan, initialState);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const length = lengthOf(start, end);

  useEffect(() => {
    if (state === initialState) return;
    if (state.formError) notice.current?.focus();
    else {
      form.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }
  }, [state]);

  return (
    <form
      ref={form}
      action={formAction}
      noValidate
      className="flex flex-col gap-4"
    >
      {state.formError && (
        <div ref={notice} tabIndex={-1}>
          <Notice tone="error" alert={false}>
            <RequestRefusal formError={state.formError} />
          </Notice>
        </div>
      )}
      <input type="hidden" name="itemId" value={itemId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id="startDate"
          label={requestForm.from}
          errors={state.fieldErrors?.startDate}
        >
          {(control) => (
            <TextInput
              {...control}
              type="date"
              name="startDate"
              min={minStart}
              max={maxStart}
              defaultValue={state.values?.startDate}
              onChange={(event) => setStart(event.target.value)}
            />
          )}
        </Field>
        <Field
          id="endDate"
          label={requestForm.to}
          errors={state.fieldErrors?.endDate}
        >
          {(control) => (
            <TextInput
              {...control}
              aria-describedby={
                [control["aria-describedby"], length ? LENGTH_ID : undefined]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              type="date"
              name="endDate"
              min={isIsoDate(start) ? start : minStart}
              defaultValue={state.values?.endDate}
              onChange={(event) => setEnd(event.target.value)}
            />
          )}
        </Field>
      </div>
      {length !== null && (
        <RequestLengthLine
          id={LENGTH_ID}
          length={length}
          ownerName={ownerName}
          maxLoanDays={maxLoanDays}
        />
      )}
      <Field
        id="message"
        label={t(requestForm.message, { owner: ownerName })}
        errors={state.fieldErrors?.message}
      >
        {(control) => (
          <TextArea
            {...control}
            name="message"
            maxLength={LOAN_MESSAGE_MAX}
            defaultValue={state.values?.message}
          />
        )}
      </Field>
      <Button type="submit" className="w-full sm:w-auto sm:self-start">
        {requestForm.send}
      </Button>
    </form>
  );
}
