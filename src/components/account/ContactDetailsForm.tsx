"use client";

import { useActionState, useEffect, useRef } from "react";
import { updateContactDetails } from "@/actions/account";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import TextArea from "@/components/ui/TextArea";
import { showToast } from "@/lib/feedback/toast";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import type { ContactDetailsFormState } from "@/types/account";

type ContactDetailsFormProps = {
  contactDetails: string | null;
  locked: boolean;
};

const initialState: ContactDetailsFormState = {};

// Announced before the state lands, so a re-render can't lose the toast.
async function saveAndAnnounce(
  prev: ContactDetailsFormState,
  formData: FormData,
): Promise<ContactDetailsFormState> {
  const next = await updateContactDetails(prev, formData);
  if (next.flash) showToast(next.flash);
  return next;
}

// No maxLength: the limit is counted on the server after CRLF normalisation.
export default function ContactDetailsForm({
  contactDetails,
  locked,
}: ContactDetailsFormProps) {
  const [state, formAction] = useActionState(saveAndAnnounce, initialState);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state === initialState || state.flash) return;
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
            {state.formError === "contactDetailsLocked"
              ? account.contactLocked
              : errors.actionFailed}
          </Notice>
        </div>
      )}
      <Field
        id="contactDetails"
        label={account.contactLabel}
        hint={account.contactHint}
        errors={state.fieldErrors?.contactDetails}
      >
        {(control) => (
          <TextArea
            {...control}
            name="contactDetails"
            rows={5}
            defaultValue={state.contactDetails ?? contactDetails ?? ""}
          />
        )}
      </Field>
      {locked && <Notice tone="info">{account.contactLocked}</Notice>}
      <Button type="submit" className="w-full sm:w-auto sm:self-start">
        {account.saveContact}
      </Button>
    </form>
  );
}
