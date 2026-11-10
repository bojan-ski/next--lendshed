"use client";

import { useActionState, useEffect, useRef } from "react";
import { changePassword } from "@/actions/account";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import PasswordInput from "@/components/ui/PasswordInput";
import { showToast } from "@/lib/feedback/toast";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import type { ChangePasswordState } from "@/types/account";

const formErrorText: Record<
  NonNullable<ChangePasswordState["formError"]>,
  string
> = {
  tooManyAttempts: account.tooManyAttempts,
  unexpected: errors.actionFailed,
};

const initialState: ChangePasswordState = {};

// Announced before the state lands: the new session cookie re-renders the page.
async function changeAndAnnounce(
  prev: ChangePasswordState,
  formData: FormData,
): Promise<ChangePasswordState> {
  const next = await changePassword(prev, formData);
  if (next.flash) showToast(next.flash);
  return next;
}

// Nothing is echoed: the reset after every submit leaves both fields empty.
export default function ChangePasswordForm() {
  const [state, formAction] = useActionState(changeAndAnnounce, initialState);
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
            {formErrorText[state.formError]}
          </Notice>
        </div>
      )}
      <Field
        id="currentPassword"
        label={account.currentPasswordLabel}
        errors={state.fieldErrors?.currentPassword}
      >
        {(control) => (
          <PasswordInput
            {...control}
            name="currentPassword"
            autoComplete="current-password"
            aria-required
          />
        )}
      </Field>
      <Field
        id="newPassword"
        label={account.newPasswordLabel}
        hint={account.newPasswordHint}
        errors={state.fieldErrors?.newPassword}
      >
        {(control) => (
          <PasswordInput
            {...control}
            name="newPassword"
            autoComplete="new-password"
            aria-required
          />
        )}
      </Field>
      <Button type="submit" className="w-full sm:w-auto sm:self-start">
        {account.changePassword}
      </Button>
    </form>
  );
}
