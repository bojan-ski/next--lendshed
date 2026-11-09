"use client";

import { useActionState } from "react";
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

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.formError && (
        <Notice tone="error">{formErrorText[state.formError]}</Notice>
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
