"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { retireOwnItem } from "@/actions/items";
import { ITEM_HEADING_ID } from "@/components/items/ids";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { showToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { items } from "@/strings/items";
import type { RetireItemState } from "@/types/item";

const initialState: RetireItemState = {};

// A successful retire turns the page read-only in the same commit as the new
// state, so an effect would never run: announce before the state lands.
async function retireAndAnnounce(
  prev: RetireItemState,
  formData: FormData,
): Promise<RetireItemState> {
  const next = await retireOwnItem(prev, formData);
  if (next.flash) {
    showToast(next.flash);
    document.getElementById(ITEM_HEADING_ID)?.focus();
  }
  return next;
}

// Retire, then a confirmation step naming the item, then the action.
export default function RetireItemButton({
  itemId,
  title,
}: {
  itemId: string;
  title: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(retireAndAnnounce, initialState);
  const toggle = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const kept = useRef(false);
  // Focus lands on the confirm button: its description names the item.
  const questionId = "retire-item-question";

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
          : state.formError === "blocked"
            ? items.blockedRefusal
            : errors.actionFailed}
      </Notice>
    </div>
  );

  // Stale or booked: the page is out of date, so there is nothing to retry.
  if (state.formError === "stale" || state.formError === "blocked") {
    return failure;
  }

  if (!confirming) {
    return (
      <Button
        ref={toggle}
        variant="outline"
        aria-label={t(items.retireFor, { title })}
        className="w-full sm:w-auto sm:self-start"
        onClick={() => setConfirming(true)}
      >
        {items.retire}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {failure}
      <p id={questionId} className="text-sm text-muted wrap-break-word">
        {t(items.retireConfirm, { title })}
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
          {items.retireConfirmButton}
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
