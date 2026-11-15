"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { retireItemAsOrganizer } from "@/actions/items";
import Button from "@/components/ui/Button";
import Field from "@/components/ui/Field";
import Notice from "@/components/ui/Notice";
import TextArea from "@/components/ui/TextArea";
import { RETIRED_NOTE_MAX } from "@/lib/schemas/items";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { itemPage } from "@/strings/itemPage";
import { items } from "@/strings/items";
import type { OrganizerRetireState } from "@/types/item";

const initialState: OrganizerRetireState = {};

// RetireItemButton with a required note. Success redirects to Browse, which
// shows the toast; opening the step focuses the note.
export default function OrganizerRetireForm({
  itemId,
  title,
}: {
  itemId: string;
  title: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(
    retireItemAsOrganizer,
    initialState,
  );
  const toggle = useRef<HTMLButtonElement>(null);
  const note = useRef<HTMLTextAreaElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const kept = useRef(false);
  const questionId = "organizer-retire-question";

  useEffect(() => {
    if (confirming) note.current?.focus();
    else if (kept.current) {
      kept.current = false;
      toggle.current?.focus();
    }
  }, [confirming]);

  useEffect(() => {
    if (state.formError) notice.current?.focus();
    else if (state.fieldErrors?.note) note.current?.focus();
  }, [state]);

  const failure = state.formError && (
    <div ref={notice} tabIndex={-1}>
      <Notice tone="error" alert={false}>
        {state.formError === "stale"
          ? errors.stale
          : state.formError === "stillOut"
            ? itemPage.retireStillOut
            : errors.actionFailed}
      </Notice>
    </div>
  );

  // Stale or out: the page is out of date, so there is nothing to retry.
  if (state.formError === "stale" || state.formError === "stillOut") {
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
    <form action={formAction} noValidate className="flex flex-col gap-3">
      {failure}
      <p id={questionId} className="text-sm text-muted wrap-break-word">
        {t(itemPage.retireQuestion, { title })}
      </p>
      <input type="hidden" name="id" value={itemId} />
      <Field
        id="organizer-retire-note"
        label={itemPage.retireNoteLabel}
        hint={itemPage.retireNoteHint}
        errors={state.fieldErrors?.note}
      >
        {(control) => (
          <TextArea
            {...control}
            ref={note}
            name="note"
            rows={3}
            maxLength={RETIRED_NOTE_MAX}
            defaultValue={state.values?.note}
            className="text-base"
          />
        )}
      </Field>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button type="submit" variant="outline" aria-describedby={questionId}>
          {items.retireConfirmButton}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            kept.current = true;
            setConfirming(false);
          }}
        >
          {itemPage.keep}
        </Button>
      </div>
    </form>
  );
}
