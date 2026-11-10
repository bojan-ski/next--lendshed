"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { joinWithInvitation } from "@/actions/invitations";
import LinkBroken from "@/components/auth/LinkBroken";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import PasswordInput from "@/components/ui/PasswordInput";
import TextInput from "@/components/ui/TextInput";
import { publicEnv } from "@/lib/env/public";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { join } from "@/strings/join";
import type { JoinState } from "@/types/auth";

const initialState: JoinState = {};

// The token is checked only on submit: every token gets this same form.
export default function JoinForm({
  token,
  community,
}: {
  token: string;
  community: string;
}) {
  const [state, formAction] = useActionState(joinWithInvitation, initialState);
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

  const houseRulesError = state.fieldErrors?.acceptHouseRules?.[0];
  // A refused submit that didn't flag the checkbox had it ticked.
  const houseRulesTicked =
    (state.fieldErrors !== undefined || state.formError !== undefined) &&
    !houseRulesError;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">
        {t(join.heading, {
          appName: publicEnv.NEXT_PUBLIC_APP_NAME,
          community,
        })}
      </h1>
      <form
        ref={form}
        action={formAction}
        noValidate
        className="flex flex-col gap-4"
      >
        {state.formError && (
          <div ref={notice} tabIndex={-1}>
            <Notice tone="error" alert={false}>
              {errors.actionFailed}
            </Notice>
          </div>
        )}
        <input type="hidden" name="token" value={token} />
        <Field
          id="name"
          label={join.nameLabel}
          hint={join.nameHint}
          errors={state.fieldErrors?.name}
        >
          {(control) => (
            <TextInput
              {...control}
              name="name"
              autoComplete="name"
              aria-required
              defaultValue={state.name}
            />
          )}
        </Field>
        <Field
          id="email"
          label={join.emailLabel}
          errors={state.fieldErrors?.email}
        >
          {(control) => (
            <TextInput
              {...control}
              name="email"
              type="email"
              autoComplete="email"
              aria-required
              defaultValue={state.email}
            />
          )}
        </Field>
        <Field
          id="password"
          label={join.passwordLabel}
          hint={join.passwordHint}
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
        <div className="flex flex-col gap-1.5">
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              name="acceptHouseRules"
              defaultChecked={houseRulesTicked}
              aria-required
              aria-invalid={houseRulesError ? true : undefined}
              aria-describedby={
                houseRulesError ? "acceptHouseRules-error" : undefined
              }
              className="size-5 shrink-0 accent-accent"
            />
            <span>
              {join.houseRulesBefore}
              <Link href="/house-rules" className="text-accent underline">
                {join.houseRulesLink}
              </Link>
            </span>
          </label>
          {houseRulesError && (
            <p id="acceptHouseRules-error" className="text-base">
              {houseRulesError}
            </p>
          )}
        </div>
        <Button type="submit" className="w-full">
          {join.submit}
        </Button>
      </form>
    </div>
  );
}
