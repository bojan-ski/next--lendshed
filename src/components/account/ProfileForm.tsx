"use client";

import { useActionState, useEffect, useRef } from "react";
import { updateProfile } from "@/actions/account";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import TextInput from "@/components/ui/TextInput";
import { showToast } from "@/lib/feedback/toast";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import type { ProfileFormState } from "@/types/account";

type ProfileFormProps = {
  name: string;
  area: string | null;
  email: string;
};

const initialState: ProfileFormState = {};

// Announced before the state lands, so a re-render can't lose the toast.
async function saveAndAnnounce(
  prev: ProfileFormState,
  formData: FormData,
): Promise<ProfileFormState> {
  const next = await updateProfile(prev, formData);
  if (next.flash) showToast(next.flash);
  return next;
}

// The form resets after every submit: echoed values win, else the saved ones.
export default function ProfileForm({ name, area, email }: ProfileFormProps) {
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
            {errors.actionFailed}
          </Notice>
        </div>
      )}
      <Field
        id="name"
        label={account.nameLabel}
        hint={account.nameHint}
        errors={state.fieldErrors?.name}
      >
        {(control) => (
          <TextInput
            {...control}
            name="name"
            autoComplete="name"
            aria-required
            defaultValue={state.name ?? name}
          />
        )}
      </Field>
      <Field
        id="area"
        label={account.areaLabel}
        hint={account.areaHint}
        errors={state.fieldErrors?.area}
      >
        {(control) => (
          <TextInput
            {...control}
            name="area"
            autoComplete="off"
            defaultValue={state.area ?? area ?? ""}
          />
        )}
      </Field>
      <div className="flex flex-col gap-1">
        <p className="font-bold">{account.emailLabel}</p>
        <p className="wrap-break-word">{email}</p>
        <p className="text-sm text-muted">{account.emailNote}</p>
      </div>
      <Button type="submit" className="w-full sm:w-auto sm:self-start">
        {account.saveProfile}
      </Button>
    </form>
  );
}
