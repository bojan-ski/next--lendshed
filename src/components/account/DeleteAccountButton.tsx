"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteOwnAccount } from "@/actions/account";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import type { DeleteAccountState } from "@/types/account";

const initialState: DeleteAccountState = {};

const failureText: Record<
  NonNullable<DeleteAccountState["formError"]>,
  string
> = {
  stale: errors.stale,
  itemOut: account.deleteBlockedItemOut,
  holdingItem: account.deleteBlockedHolding,
  lastOrganizer: account.deleteBlockedLastOrganizer,
  unexpected: errors.actionFailed,
};

// Delete account, then a confirmation step that lists what happens. Success
// redirects to /login, where the Toaster reads the flash cookie.
export default function DeleteAccountButton({
  isOrganizer,
}: {
  isOrganizer: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(deleteOwnAccount, initialState);
  const toggle = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const kept = useRef(false);
  // Focus lands on the confirm button: its description is the whole list.
  const questionId = "delete-account-question";

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
        {failureText[state.formError]}
      </Notice>
    </div>
  );

  // The page was out of date: only an unexpected failure is worth retrying.
  if (state.formError && state.formError !== "unexpected") return failure;

  if (!confirming) {
    return (
      <Button
        ref={toggle}
        variant="outline"
        className="max-sm:w-full sm:self-start"
        onClick={() => setConfirming(true)}
      >
        {account.deleteAccount}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {failure}
      <div id={questionId} className="flex flex-col gap-2 text-sm">
        <p>{account.deleteConfirm}</p>
        <ul className="list-disc pl-5 text-muted">
          <li>{account.deleteSignOut}</li>
          <li>{account.deleteLoans}</li>
          <li>{account.deleteItems}</li>
          <li>{account.deletePhotos}</li>
          <li>{account.deleteHistory}</li>
          {isOrganizer && <li>{account.deleteInvitations}</li>}
          <li>{account.deleteFinal}</li>
        </ul>
      </div>
      <input type="hidden" name="confirm" value="true" />
      <div className="flex gap-2">
        <Button
          ref={confirm}
          type="submit"
          variant="outline"
          aria-describedby={questionId}
          className="max-sm:flex-1"
        >
          {account.deleteConfirmButton}
        </Button>
        <Button
          variant="outline"
          className="max-sm:flex-1"
          onClick={() => {
            kept.current = true;
            setConfirming(false);
          }}
        >
          {account.keepAccount}
        </Button>
      </div>
    </form>
  );
}
