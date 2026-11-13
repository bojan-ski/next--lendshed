"use client";

import { useActionState, useEffect, useRef } from "react";
import { createInvitation } from "@/actions/invitations";
import OneTimeLinkPanel from "@/components/feedback/OneTimeLinkPanel";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import TextInput from "@/components/ui/TextInput";
import { errors } from "@/strings/errors";
import { invitations } from "@/strings/invitations";
import type { InvitationFormState } from "@/types/invitation";

// The form resets after every submit; on a refused one the typed note is put
// back from here (the action's state carries no echo of it).
type FormState = InvitationFormState & { note?: string };

const initialState: FormState = {};

async function createAndEcho(
  prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const next = await createInvitation(prev, formData);
  if (next.created) return next;
  const note = formData.get("note");
  return { ...next, note: typeof note === "string" ? note : undefined };
}

export default function NewInvitationForm() {
  const [state, formAction] = useActionState(createAndEcho, initialState);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);

  // A new link focuses its own panel.
  useEffect(() => {
    if (state === initialState || state.created) return;
    if (state.formError) notice.current?.focus();
    else {
      form.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-4 sm:p-6">
        <form
          ref={form}
          action={formAction}
          noValidate
          className="flex flex-col gap-4"
        >
          {state.formError && (
            <div ref={notice} tabIndex={-1}>
              <Notice tone="error" alert={false}>
                {state.formError === "stale"
                  ? errors.stale
                  : errors.actionFailed}
              </Notice>
            </div>
          )}
          <Field
            id="note"
            label={invitations.noteLabel}
            hint={invitations.noteHint}
            errors={state.fieldErrors?.note}
          >
            {(control) => (
              <TextInput
                {...control}
                name="note"
                autoComplete="off"
                defaultValue={state.note}
              />
            )}
          </Field>
          <Button type="submit" className="sm:self-start">
            {invitations.submit}
          </Button>
        </form>
      </Card>
      {state.created && (
        <OneTimeLinkPanel key={state.created.url} link={state.created} />
      )}
    </div>
  );
}
