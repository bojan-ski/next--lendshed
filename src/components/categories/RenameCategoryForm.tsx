"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { renameCategory } from "@/actions/categories";
import { CATEGORIES_HEADING_ID } from "@/components/categories/ids";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import TextInput from "@/components/ui/TextInput";
import { showToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { categories } from "@/strings/categories";
import { errors } from "@/strings/errors";
import type { CategoryDTO, RenameCategoryState } from "@/types/categories";

const initialState: RenameCategoryState = {};

// Closed: the Rename button. Open: the editor, which owns the action state, so
// closing it clears any earlier error.
export default function RenameCategoryForm({
  category,
}: {
  category: CategoryDTO;
}) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (!open && returnFocus.current) {
      returnFocus.current = false;
      toggle.current?.focus();
    }
  }, [open]);

  if (open) {
    return (
      <RenameEditor
        category={category}
        onCancel={() => {
          returnFocus.current = true;
          setOpen(false);
        }}
        onRenamed={() => setOpen(false)}
      />
    );
  }

  return (
    <Button
      ref={toggle}
      variant="outline"
      aria-label={t(categories.renameFor, { name: category.name })}
      className="max-lg:w-full"
      onClick={() => setOpen(true)}
    >
      {categories.rename}
    </Button>
  );
}

function RenameEditor({
  category,
  onCancel,
  onRenamed,
}: {
  category: CategoryDTO;
  onCancel: () => void;
  onRenamed: () => void;
}) {
  // The row may move when re-sorted: focus goes to the section heading.
  async function renameAndAnnounce(
    prev: RenameCategoryState,
    formData: FormData,
  ): Promise<RenameCategoryState> {
    const next = await renameCategory(prev, formData);
    if (next.flash) {
      showToast(next.flash);
      document.getElementById(CATEGORIES_HEADING_ID)?.focus();
      onRenamed();
    }
    return next;
  }

  const [state, formAction] = useActionState(renameAndAnnounce, initialState);
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const fieldId = `category-name-${category.id}`;

  // Opening focuses the field; a refusal focuses its notice or the field.
  useEffect(() => {
    if (state.flash) return;
    if (state.formError) notice.current?.focus();
    else form.current?.querySelector<HTMLElement>(`#${fieldId}`)?.focus();
  }, [state, fieldId]);

  const failure = state.formError && (
    <div ref={notice} tabIndex={-1} className="w-full">
      <Notice tone="error" alert={false}>
        {state.formError === "stale" ? errors.stale : errors.actionFailed}
      </Notice>
    </div>
  );

  // Stale: the category is gone, so there is nothing to retry.
  if (state.formError === "stale") return failure;

  return (
    <form
      ref={form}
      action={formAction}
      noValidate
      className="flex w-full flex-col gap-3"
    >
      {failure}
      <input type="hidden" name="id" value={category.id} />
      <Field
        id={fieldId}
        label={t(categories.renameLabel, { name: category.name })}
        hint={categories.nameHint}
        errors={state.fieldErrors?.name}
      >
        {(control) => (
          <TextInput
            {...control}
            name="name"
            autoComplete="off"
            aria-required
            defaultValue={state.values?.name ?? category.name}
          />
        )}
      </Field>
      <div className="flex gap-2">
        <Button type="submit" variant="outline" className="max-lg:flex-1">
          {categories.save}
        </Button>
        <Button variant="outline" className="max-lg:flex-1" onClick={onCancel}>
          {categories.cancel}
        </Button>
      </div>
    </form>
  );
}
