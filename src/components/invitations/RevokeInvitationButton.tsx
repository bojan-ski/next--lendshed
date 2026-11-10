"use client";

import { useActionState, useEffect, useRef } from "react";
import { revokeInvitation } from "@/actions/invitations";
import { OPEN_INVITATIONS_HEADING_ID } from "@/components/invitations/ids";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { showToast } from "@/lib/feedback/toast";
import { errors } from "@/strings/errors";
import { invitations } from "@/strings/invitations";
import type { RevokeInvitationState } from "@/types/invitation";

const initialState: RevokeInvitationState = {};

// A successful revoke's refresh() removes this row in the same commit as the
// new state, so an effect would never run: announce before the state lands.
async function revokeAndAnnounce(
  prev: RevokeInvitationState,
  formData: FormData,
): Promise<RevokeInvitationState> {
  const next = await revokeInvitation(prev, formData);
  if (next.flash) {
    showToast(next.flash);
    document.getElementById(OPEN_INVITATIONS_HEADING_ID)?.focus();
  }
  return next;
}

// `label` names the row's invitation: every row's visible text is "Revoke".
export default function RevokeInvitationButton({
  id,
  label,
}: {
  id: string;
  label: string;
}) {
  const [state, formAction] = useActionState(revokeAndAnnounce, initialState);
  const notice = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.formError) notice.current?.focus();
  }, [state]);

  const failure = state.formError && (
    <div ref={notice} tabIndex={-1}>
      <Notice tone="error" alert={false}>
        {state.formError === "stale" ? errors.stale : errors.actionFailed}
      </Notice>
    </div>
  );

  // Stale: the invitation is no longer open, so there is nothing to retry.
  if (state.formError === "stale") return failure;

  return (
    <form action={formAction} className="flex flex-col gap-2">
      {failure}
      <input type="hidden" name="id" value={id} />
      <Button
        type="submit"
        variant="outline"
        aria-label={label}
        className="max-sm:w-full"
      >
        {invitations.revoke}
      </Button>
    </form>
  );
}
