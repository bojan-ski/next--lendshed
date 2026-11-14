"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { deleteMember } from "@/actions/members";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { members } from "@/strings/members";
import type { DeleteMemberState } from "@/types/members";

const initialState: DeleteMemberState = {};

const failureText: Record<
  NonNullable<DeleteMemberState["formError"]>,
  string
> = {
  self: members.deleteSelf,
  stale: errors.stale,
  itemOut: members.deleteItemOut,
  holdingItem: members.deleteHolding,
  unexpected: errors.actionFailed,
};

// Delete account, then a confirmation step naming the person. Success
// redirects to Members, where the Toaster reads the flash cookie.
export default function DeleteMemberButton({
  memberId,
  memberName,
}: {
  memberId: string;
  memberName: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(deleteMember, initialState);
  const toggle = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const kept = useRef(false);
  // Focus lands on the confirm button: its description is the whole list.
  const questionId = "delete-member-question";

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
        aria-label={t(members.deleteFor, { name: memberName })}
        className="max-sm:w-full sm:self-start"
        onClick={() => setConfirming(true)}
      >
        {members.deleteAccount}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {failure}
      <div id={questionId} className="flex flex-col gap-2 text-sm">
        <p className="wrap-break-word">
          {t(members.deleteConfirm, { name: memberName })}
        </p>
        <ul className="list-disc pl-5 text-muted">
          <li>{members.deleteLoans}</li>
          <li>{members.deleteItems}</li>
          <li>{members.deletePhotos}</li>
          <li>{members.deleteHistory}</li>
          <li>{members.deleteFinal}</li>
        </ul>
      </div>
      <input type="hidden" name="id" value={memberId} />
      <div className="flex gap-2">
        <Button
          ref={confirm}
          type="submit"
          variant="outline"
          aria-describedby={questionId}
          className="max-sm:flex-1"
        >
          {members.deleteAccount}
        </Button>
        <Button
          variant="outline"
          className="max-sm:flex-1"
          onClick={() => {
            kept.current = true;
            setConfirming(false);
          }}
        >
          {members.keepAccount}
        </Button>
      </div>
    </form>
  );
}
