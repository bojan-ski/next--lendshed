"use client";

import { useActionState, useEffect, useRef } from "react";
import { createItem, updateItem } from "@/actions/items";
import ItemDetailsFields from "@/components/items/ItemDetailsFields";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { showToast } from "@/lib/feedback/toast";
import { ITEM_CAP, ITEM_MAX_LOAN_DAYS_DEFAULT } from "@/lib/schemas/items";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { items } from "@/strings/items";
import type { CategoryDTO } from "@/types/categories";
import type {
  ItemDetailsDefaults,
  ItemDetailsField,
  ItemDetailsFormState,
} from "@/types/item";

type ItemDetailsFormProps = {
  categories: CategoryDTO[];
  // Edit mode when present; create mode (step 1 of 2) otherwise.
  item?: ItemDetailsDefaults;
};

const initialState: ItemDetailsFormState = {};

// Announced before the state lands, so a re-render can't lose the toast.
async function saveAndAnnounce(
  prev: ItemDetailsFormState,
  formData: FormData,
): Promise<ItemDetailsFormState> {
  const next = await updateItem(prev, formData);
  if (next.flash) showToast(next.flash);
  return next;
}

function savedValues(
  item?: ItemDetailsDefaults,
): Record<ItemDetailsField, string> {
  return {
    title: item?.title ?? "",
    description: item?.description ?? "",
    categoryId: item?.categoryId ?? "",
    condition: item?.condition ?? "",
    maxLoanDays: String(item?.maxLoanDays ?? ITEM_MAX_LOAN_DAYS_DEFAULT),
    pickupNotes: item?.pickupNotes ?? "",
  };
}

// A refused submit resets the form, so the typed values come back from state.
export default function ItemDetailsForm({
  categories,
  item,
}: ItemDetailsFormProps) {
  const [state, formAction] = useActionState(
    item ? saveAndAnnounce : createItem,
    initialState,
  );
  const form = useRef<HTMLFormElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const submit = useRef<HTMLButtonElement>(null);

  // A save leaves focus where it was: the pending button was disabled, which
  // dropped it.
  useEffect(() => {
    if (state === initialState) return;
    if (state.flash) submit.current?.focus();
    else if (state.formError) notice.current?.focus();
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
            {state.formError === "capReached"
              ? t(items.capNotice, { cap: ITEM_CAP })
              : state.formError === "stale"
                ? errors.stale
                : errors.actionFailed}
          </Notice>
        </div>
      )}
      {item && <input type="hidden" name="id" value={item.id} />}
      <ItemDetailsFields
        categories={categories}
        values={{ ...savedValues(item), ...state.values }}
        errors={state.fieldErrors}
      />
      <Button
        ref={submit}
        type="submit"
        className="w-full sm:w-auto sm:self-start"
      >
        {item ? items.saveChanges : items.saveAndContinue}
      </Button>
    </form>
  );
}
