"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteCategory } from "@/actions/categories";
import { CATEGORIES_HEADING_ID } from "@/components/categories/ids";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { showToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { categories } from "@/strings/categories";
import { errors } from "@/strings/errors";
import type { CategoryDTO, DeleteCategoryState } from "@/types/categories";

const initialState: DeleteCategoryState = {};

// A successful delete removes this row in the same commit as the new state, so
// an effect would never run: announce before the state lands.
async function deleteAndAnnounce(
  prev: DeleteCategoryState,
  formData: FormData,
): Promise<DeleteCategoryState> {
  const next = await deleteCategory(prev, formData);
  if (next.flash) {
    showToast(next.flash);
    document.getElementById(CATEGORIES_HEADING_ID)?.focus();
  }
  return next;
}

// Delete, then a confirmation step naming the category, then the action.
export default function DeleteCategoryButton({
  category,
}: {
  category: CategoryDTO;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(deleteAndAnnounce, initialState);
  const toggle = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const kept = useRef(false);
  // Focus lands on the confirm button: its description names the category.
  const questionId = `delete-category-${category.id}`;

  useEffect(() => {
    if (confirming) confirm.current?.focus();
    else if (kept.current) {
      kept.current = false;
      toggle.current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    if (state.formError) notice.current?.focus();
  }, [state]);

  const failure = state.formError && (
    <div ref={notice} tabIndex={-1} className="w-full">
      <Notice tone="error" alert={false}>
        {state.formError === "stale"
          ? errors.stale
          : state.formError === "inUse"
            ? categories.inUseRefusal
            : errors.actionFailed}
      </Notice>
    </div>
  );

  // Stale (gone) or in use (an item took it): there is nothing to retry.
  if (state.formError === "stale" || state.formError === "inUse") {
    return failure;
  }

  if (!confirming) {
    return (
      <Button
        ref={toggle}
        variant="outline"
        aria-label={t(categories.deleteFor, { name: category.name })}
        className="max-lg:flex-1"
        onClick={() => setConfirming(true)}
      >
        {categories.delete}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      {failure}
      <p id={questionId} className="text-sm text-muted wrap-break-word">
        {t(categories.deleteConfirm, { name: category.name })}
      </p>
      <input type="hidden" name="id" value={category.id} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button
          ref={confirm}
          type="submit"
          variant="outline"
          aria-describedby={questionId}
          className="sm:max-lg:flex-1"
        >
          {categories.deleteConfirmButton}
        </Button>
        <Button
          variant="outline"
          className="sm:max-lg:flex-1"
          onClick={() => {
            kept.current = true;
            setConfirming(false);
          }}
        >
          {categories.keep}
        </Button>
      </div>
    </form>
  );
}
