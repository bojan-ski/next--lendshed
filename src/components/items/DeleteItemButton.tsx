"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteItem } from "@/actions/items";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { items } from "@/strings/items";
import type { DeleteItemState } from "@/types/item";

const initialState: DeleteItemState = {};

// Delete, then a confirmation step naming the item, then the action. Success
// redirects to My items, where the Toaster reads the flash cookie.
export default function DeleteItemButton({
  itemId,
  title,
}: {
  itemId: string;
  title: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(deleteItem, initialState);
  const toggle = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const kept = useRef(false);
  // Focus lands on the confirm button: its description names the item.
  const questionId = "delete-item-question";

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
    <div ref={notice} tabIndex={-1}>
      <Notice tone="error" alert={false}>
        {state.formError === "stale"
          ? errors.stale
          : state.formError === "hasLoans"
            ? items.hasLoansRefusal
            : errors.actionFailed}
      </Notice>
    </div>
  );

  // Stale or requested since: the page is out of date, so nothing to retry.
  if (state.formError === "stale" || state.formError === "hasLoans") {
    return failure;
  }

  if (!confirming) {
    return (
      <Button
        ref={toggle}
        variant="outline"
        aria-label={t(items.deleteFor, { title })}
        className="w-full sm:w-auto sm:self-start"
        onClick={() => setConfirming(true)}
      >
        {items.delete}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {failure}
      <p id={questionId} className="text-sm text-muted wrap-break-word">
        {t(items.deleteConfirm, { title })}
      </p>
      <input type="hidden" name="id" value={itemId} />
      <div className="flex gap-2">
        <Button
          ref={confirm}
          type="submit"
          variant="outline"
          aria-describedby={questionId}
          className="max-sm:flex-1"
        >
          {items.deleteConfirmButton}
        </Button>
        <Button
          variant="outline"
          className="max-sm:flex-1"
          onClick={() => {
            kept.current = true;
            setConfirming(false);
          }}
        >
          {items.keep}
        </Button>
      </div>
    </form>
  );
}
