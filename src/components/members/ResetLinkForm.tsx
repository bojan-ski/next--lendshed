"use client";

import { useActionState, useEffect, useRef } from "react";
import { createResetLink } from "@/actions/members";
import OneTimeLinkPanel from "@/components/feedback/OneTimeLinkPanel";
import Button from "@/components/ui/Button";
import Notice from "@/components/ui/Notice";
import { errors } from "@/strings/errors";
import { members } from "@/strings/members";
import type { ResetLinkState } from "@/types/members";

const initialState: ResetLinkState = {};

const failureText: Record<NonNullable<ResetLinkState["formError"]>, string> = {
  self: members.resetSelf,
  stale: errors.stale,
  unexpected: errors.actionFailed,
};

// The link lives only in this state: shown once, replaced by the next create.
export default function ResetLinkForm({ memberId }: { memberId: string }) {
  const [state, formAction] = useActionState(createResetLink, initialState);
  const notice = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.formError) notice.current?.focus();
  }, [state]);

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} className="flex flex-col gap-3">
        {state.formError && (
          <div ref={notice} tabIndex={-1}>
            <Notice tone="error" alert={false}>
              {failureText[state.formError]}
            </Notice>
          </div>
        )}
        <input type="hidden" name="id" value={memberId} />
        <Button type="submit" className="max-sm:w-full sm:self-start">
          {members.createResetLink}
        </Button>
      </form>
      {state.created && (
        <OneTimeLinkPanel
          key={state.created.url}
          link={state.created}
          headingLevel={3}
        />
      )}
    </div>
  );
}
