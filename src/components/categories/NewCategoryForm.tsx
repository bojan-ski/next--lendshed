"use client";

import { useActionState, useEffect, useRef } from "react";
import { createCategory } from "@/actions/categories";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import TextInput from "@/components/ui/TextInput";
import { showToast } from "@/lib/feedback/toast";
import { categories } from "@/strings/categories";
import { errors } from "@/strings/errors";
import type { NewCategoryState } from "@/types/categories";

const initialState: NewCategoryState = {};

// Announced before the state lands, so a re-render can't lose the toast.
async function addAndAnnounce(
  prev: NewCategoryState,
  formData: FormData,
): Promise<NewCategoryState> {
  const next = await createCategory(prev, formData);
  if (next.flash) showToast(next.flash);
  return next;
}

// The form resets after every submit: a refused one puts the typed name back.
export default function NewCategoryForm() {
  const [state, formAction] = useActionState(addAndAnnounce, initialState);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);

  // A success leaves focus in the emptied field, ready for the next name.
  useEffect(() => {
    if (state === initialState) return;
    if (state.formError) notice.current?.focus();
    else if (state.flash) {
      form.current?.querySelector<HTMLElement>("#category-name")?.focus();
    } else {
      form.current
        ?.querySelector<HTMLElement>('[aria-invalid="true"]')
        ?.focus();
    }
  }, [state]);

  return (
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
              {errors.actionFailed}
            </Notice>
          </div>
        )}
        <Field
          id="category-name"
          label={categories.nameLabel}
          hint={categories.nameHint}
          errors={state.fieldErrors?.name}
        >
          {(control) => (
            <TextInput
              {...control}
              name="name"
              autoComplete="off"
              aria-required
              defaultValue={state.values?.name}
            />
          )}
        </Field>
        <Button type="submit" className="w-full sm:w-auto sm:self-start">
          {categories.add}
        </Button>
      </form>
    </Card>
  );
}
