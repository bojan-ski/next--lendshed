"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { hideItem, listItem } from "@/actions/items";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { showToast } from "@/lib/feedback/toast";
import { errors } from "@/strings/errors";
import { items } from "@/strings/items";
import type { ItemVisibilityState } from "@/types/item";

type ItemVisibilityControlProps = {
  itemId: string;
  status: "hidden" | "listed";
  hasPhoto: boolean;
  ownerHasContactDetails: boolean;
};

type Intent = "list" | "hide";

// The intent a refusal answered: once the status flips, it no longer applies.
type ControlState = ItemVisibilityState & { intent?: Intent };

const initialState: ControlState = {};

// What listing still needs, read with the List button (one control per page).
const NEEDS_ID = "item-visibility-needs";

// One hook for both actions, so the button (and its focus) survives the flip.
async function changeAndAnnounce(
  prev: ControlState,
  formData: FormData,
): Promise<ControlState> {
  const intent: Intent = formData.get("intent") === "hide" ? "hide" : "list";
  const next = await (intent === "hide" ? hideItem : listItem)(prev, formData);
  if (next.flash) showToast(next.flash);
  return { ...next, intent };
}

function Refusal({
  formError,
}: Pick<Required<ItemVisibilityState>, "formError">) {
  if (formError === "needsPhoto") return items.needsPhotoRefusal;
  if (formError === "needsContactDetails") {
    return (
      <>
        {items.needsContactBefore}
        <Link
          href="/account#contact-heading"
          className="font-bold text-accent-ink underline underline-offset-4"
        >
          {items.needsContactLink}
        </Link>
        {items.needsContactAfter}
      </>
    );
  }
  return formError === "stale" ? errors.stale : errors.actionFailed;
}

function needsLine(hasPhoto: boolean, hasContact: boolean): string | null {
  if (!hasPhoto && !hasContact) return items.needsBoth;
  if (!hasPhoto) return items.needsPhoto;
  if (!hasContact) return items.needsContactDetails;
  return null;
}

// The button stays enabled while something is missing: the action is the gate.
export default function ItemVisibilityControl({
  itemId,
  status,
  hasPhoto,
  ownerHasContactDetails,
}: ItemVisibilityControlProps) {
  const [state, formAction] = useActionState(changeAndAnnounce, initialState);
  const button = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const intent: Intent = status === "hidden" ? "list" : "hide";
  const formError = state.intent === intent ? state.formError : undefined;
  const needs =
    status === "hidden" ? needsLine(hasPhoto, ownerHasContactDetails) : null;

  // The pending button was disabled, which drops focus: put it back.
  useEffect(() => {
    if (state.formError) notice.current?.focus();
    else if (state.flash) button.current?.focus();
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {formError && (
        <div ref={notice} tabIndex={-1}>
          <Notice tone="error" alert={false}>
            <Refusal formError={formError} />
          </Notice>
        </div>
      )}
      <input type="hidden" name="id" value={itemId} />
      <input type="hidden" name="intent" value={intent} />
      <Button
        ref={button}
        type="submit"
        variant={intent === "list" ? "primary" : "outline"}
        aria-describedby={needs ? NEEDS_ID : undefined}
        className="w-full sm:w-auto sm:self-start"
      >
        {intent === "list" ? items.list : items.hide}
      </Button>
      {needs && (
        <p id={NEEDS_ID} className="text-sm text-on-accent-highlight">
          {needs}
        </p>
      )}
    </form>
  );
}
