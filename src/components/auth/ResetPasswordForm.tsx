"use client";

import { useActionState, useEffect, useRef } from "react";
import { resetPasswordWithGrant } from "@/actions/reset";
import {
  AUTH_BAND,
  AUTH_BODY,
  AUTH_TITLE,
} from "@/components/auth/auth-card-styles";
import LinkBroken from "@/components/auth/LinkBroken";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import PasswordInput from "@/components/ui/PasswordInput";
import { errors } from "@/strings/errors";
import { resetPassword } from "@/strings/resetPassword";
import type { ResetPasswordState } from "@/types/auth";

const initialState: ResetPasswordState = {};

// The token is checked only on submit: every token gets this same form. The
// password is never echoed; the form resets after every submit.
export default function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(
    resetPasswordWithGrant,
    initialState,
  );
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const brokenHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (state === initialState) return;
    if (state.linkBroken) brokenHeading.current?.focus();
    else if (state.formError) notice.current?.focus();
    else {
      form.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }
  }, [state]);

  if (state.linkBroken) return <LinkBroken headingRef={brokenHeading} />;

  return (
    <>
      <div className={AUTH_BAND}>
        <h1 className={AUTH_TITLE}>{resetPassword.heading}</h1>
      </div>
      <form ref={form} action={formAction} noValidate className={AUTH_BODY}>
        {state.formError && (
          <div ref={notice} tabIndex={-1}>
            <Notice tone="error" alert={false}>
              {errors.actionFailed}
            </Notice>
          </div>
        )}
        <input type="hidden" name="token" value={token} />
        <Field
          id="password"
          label={resetPassword.passwordLabel}
          hint={resetPassword.passwordHint}
          errors={state.fieldErrors?.password}
        >
          {(control) => (
            <PasswordInput
              {...control}
              name="password"
              autoComplete="new-password"
              aria-required
            />
          )}
        </Field>
        <Button type="submit" className="w-full">
          {resetPassword.submit}
        </Button>
      </form>
    </>
  );
}
