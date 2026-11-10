"use client";

import { useActionState, useEffect, useRef } from "react";
import { demoteMember, promoteMember } from "@/actions/members";
import { ROLE_HEADING_ID } from "@/components/members/ids";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { showToast } from "@/lib/feedback/toast";
import { errors } from "@/strings/errors";
import { members } from "@/strings/members";
import type { RoleChangeState } from "@/types/members";

type RoleAction = typeof promoteMember;

const initialState: RoleChangeState = {};

// A successful change's refresh() swaps this button for the opposite one in
// the same commit as the new state, so an effect would never run: announce
// and move focus before the state lands.
function announcing(action: RoleAction): RoleAction {
  return async (prev, formData) => {
    const next = await action(prev, formData);
    if (next.flash) {
      showToast(next.flash);
      document.getElementById(ROLE_HEADING_ID)?.focus();
    }
    return next;
  };
}

const promoteAndAnnounce = announcing(promoteMember);
const demoteAndAnnounce = announcing(demoteMember);

const failureText: Record<NonNullable<RoleChangeState["formError"]>, string> = {
  self: members.roleSelf,
  stale: errors.stale,
  lastOrganizer: members.lastOrganizer,
  unexpected: errors.actionFailed,
};

export default function RoleChangeButton({
  memberId,
  change,
}: {
  memberId: string;
  change: "promote" | "demote";
}) {
  const [state, formAction] = useActionState(
    change === "promote" ? promoteAndAnnounce : demoteAndAnnounce,
    initialState,
  );
  const notice = useRef<HTMLDivElement>(null);

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

  return (
    <form action={formAction} className="flex flex-col gap-3">
      {failure}
      <input type="hidden" name="id" value={memberId} />
      <Button
        type="submit"
        variant={change === "promote" ? "primary" : "outline"}
        className="max-sm:w-full sm:self-start"
      >
        {change === "promote" ? members.promote : members.demote}
      </Button>
    </form>
  );
}
