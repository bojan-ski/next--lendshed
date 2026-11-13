"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { reinstateMember, suspendMember } from "@/actions/members";
import { ACCESS_HEADING_ID } from "@/components/members/ids";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { showToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { members } from "@/strings/members";
import type { MemberStatusState } from "@/types/members";

type StatusAction = typeof suspendMember;

const initialState: MemberStatusState = {};

// A success's refresh() swaps Suspend for Reinstate in the same commit as the
// new state, so an effect would never run: announce before the state lands.
function announcing(action: StatusAction): StatusAction {
  return async (prev, formData) => {
    const next = await action(prev, formData);
    if (next.flash) {
      showToast(next.flash);
      document.getElementById(ACCESS_HEADING_ID)?.focus();
    }
    return next;
  };
}

const suspendAndAnnounce = announcing(suspendMember);
const reinstateAndAnnounce = announcing(reinstateMember);

const failureText: Record<
  NonNullable<MemberStatusState["formError"]>,
  string
> = {
  self: members.statusSelf,
  stale: errors.stale,
  lastOrganizer: members.lastOrganizer,
  unexpected: errors.actionFailed,
};

// Suspend opens a confirmation step that lists what happens; Reinstate, the
// safe direction, is one button.
export default function MemberStatusControl({
  memberId,
  memberName,
  change,
  isOrganizer,
}: {
  memberId: string;
  memberName: string;
  change: "suspend" | "reinstate";
  isOrganizer: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState(
    change === "suspend" ? suspendAndAnnounce : reinstateAndAnnounce,
    initialState,
  );
  const toggle = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const notice = useRef<HTMLDivElement>(null);
  const kept = useRef(false);
  // Focus lands on the confirm button: its description is the whole list.
  const questionId = "suspend-member-question";

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

  // Only an unexpected failure is worth retrying from this screen.
  if (state.formError && state.formError !== "unexpected") return failure;

  if (change === "reinstate") {
    return (
      <form action={formAction} className="flex flex-col gap-3">
        {failure}
        <input type="hidden" name="id" value={memberId} />
        <Button type="submit" className="max-sm:w-full sm:self-start">
          {members.reinstate}
        </Button>
      </form>
    );
  }

  if (!confirming) {
    return (
      <Button
        ref={toggle}
        variant="outline"
        aria-label={t(members.suspendFor, { name: memberName })}
        className="max-sm:w-full sm:self-start"
        onClick={() => setConfirming(true)}
      >
        {members.suspend}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {failure}
      <div id={questionId} className="flex flex-col gap-2 text-sm">
        <p className="wrap-break-word">
          {t(members.suspendConfirm, { name: memberName })}
        </p>
        <ul className="list-disc pl-5 text-muted">
          <li>{members.suspendSignOut}</li>
          <li>{members.suspendLoans}</li>
          <li>{members.suspendItems}</li>
          <li>{members.suspendOut}</li>
          {isOrganizer && <li>{members.suspendInvitations}</li>}
          <li>{members.suspendRestore}</li>
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
          {members.suspend}
        </Button>
        <Button
          variant="outline"
          className="max-sm:flex-1"
          onClick={() => {
            kept.current = true;
            setConfirming(false);
          }}
        >
          {members.keepActive}
        </Button>
      </div>
    </form>
  );
}
