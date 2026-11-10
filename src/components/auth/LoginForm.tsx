"use client";

import { useActionState, useEffect, useRef } from "react";
import { signIn } from "@/actions/auth";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import PasswordInput from "@/components/ui/PasswordInput";
import TextInput from "@/components/ui/TextInput";
import { errors } from "@/strings/errors";
import { login } from "@/strings/login";
import type { SignInFormError, SignInState } from "@/types/auth";

const formErrorText: Record<SignInFormError, string> = {
  invalidCredentials: login.invalidCredentials,
  suspended: login.suspended,
  tooManyAttempts: login.tooManyAttempts,
  unexpected: errors.actionFailed,
};

const initialState: SignInState = {};

// `next` is passed through untouched; only signIn validates it.
export default function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState(signIn, initialState);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);

  // The submit is disabled while pending, so focus would fall to <body>: move it
  // to what the user must read or fix next.
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
            {formErrorText[state.formError]}
          </Notice>
        </div>
      )}
      {next && <input type="hidden" name="next" value={next} />}
      <Field
        id="email"
        label={login.emailLabel}
        errors={state.fieldErrors?.email}
      >
        {(control) => (
          <TextInput
            {...control}
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={state.email}
          />
        )}
      </Field>
      <Field
        id="password"
        label={login.passwordLabel}
        errors={state.fieldErrors?.password}
      >
        {(control) => (
          <PasswordInput
            {...control}
            name="password"
            autoComplete="current-password"
          />
        )}
      </Field>
      <Button type="submit" className="w-full">
        {login.submit}
      </Button>
    </form>
  );
}
