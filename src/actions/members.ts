"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import {
  changeMemberRole,
  deleteMemberAccount,
  reinstateMemberAccount,
  suspendMemberAccount,
} from "@/data/members";
import { insertResetGrant } from "@/data/reset-grants";
import type { Role } from "@/generated/prisma/enums";
import { requireOrganizer } from "@/lib/auth/guards";
import { createLinkToken } from "@/lib/auth/link-tokens";
import { communityToday } from "@/lib/dates/dates";
import { env } from "@/lib/env/server";
import { setFlash } from "@/lib/feedback/flash";
import { reportUnexpected } from "@/lib/feedback/report";
import { memberIdSchema } from "@/lib/schemas/members";
import type {
  DeleteMemberOutcome,
  DeleteMemberState,
  MemberStatusState,
  ReinstateOutcome,
  ResetGrantOutcome,
  ResetLinkState,
  RoleChangeOutcome,
  RoleChangeState,
  SuspendOutcome,
} from "@/types/members";

export async function promoteMember(
  _prev: RoleChangeState,
  formData: FormData,
): Promise<RoleChangeState> {
  return changeRole("organizer", formData);
}

export async function demoteMember(
  _prev: RoleChangeState,
  formData: FormData,
): Promise<RoleChangeState> {
  return changeRole("member", formData);
}

// Not exported: a "use server" export would be one more public action.
async function changeRole(
  to: Role,
  formData: FormData,
): Promise<RoleChangeState> {
  const viewer = await requireOrganizer();
  const parsed = memberIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };
  if (parsed.data.id === viewer.id) return { formError: "self" };

  let outcome: RoleChangeOutcome;
  try {
    outcome = await changeMemberRole({
      actorId: viewer.id,
      memberId: parsed.data.id,
      to,
    });
  } catch (error) {
    reportUnexpected("changeRole", error);
    return { formError: "unexpected" };
  }
  // A refusal keeps the card on screen so its notice is seen there.
  if (outcome !== "changed") return { formError: outcome };

  refresh();
  return { flash: to === "organizer" ? "memberPromoted" : "memberDemoted" };
}

export async function suspendMember(
  _prev: MemberStatusState,
  formData: FormData,
): Promise<MemberStatusState> {
  return changeStatus("suspend", formData);
}

export async function reinstateMember(
  _prev: MemberStatusState,
  formData: FormData,
): Promise<MemberStatusState> {
  return changeStatus("reinstate", formData);
}

// Not exported, as changeRole.
async function changeStatus(
  change: "suspend" | "reinstate",
  formData: FormData,
): Promise<MemberStatusState> {
  const viewer = await requireOrganizer();
  const parsed = memberIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };
  if (parsed.data.id === viewer.id) return { formError: "self" };

  const input = { actorId: viewer.id, memberId: parsed.data.id };
  let outcome: SuspendOutcome | ReinstateOutcome;
  try {
    outcome =
      change === "suspend"
        ? await suspendMemberAccount({ ...input, today: communityToday() })
        : await reinstateMemberAccount(input);
  } catch (error) {
    reportUnexpected("changeStatus", error);
    return { formError: "unexpected" };
  }
  if (outcome !== "suspended" && outcome !== "reinstated") {
    return { formError: outcome };
  }

  refresh();
  return {
    flash: outcome === "suspended" ? "memberSuspended" : "memberReinstated",
  };
}

// Suspended members only, never self. Success leaves the deleted member's
// page, which is not-found from then on.
export async function deleteMember(
  _prev: DeleteMemberState,
  formData: FormData,
): Promise<DeleteMemberState> {
  const viewer = await requireOrganizer();
  const parsed = memberIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };
  if (parsed.data.id === viewer.id) return { formError: "self" };

  let outcome: DeleteMemberOutcome;
  try {
    outcome = await deleteMemberAccount({
      actorId: viewer.id,
      memberId: parsed.data.id,
      today: communityToday(),
    });
  } catch (error) {
    reportUnexpected("deleteMember", error);
    return { formError: "unexpected" };
  }
  if (outcome !== "deleted") return { formError: outcome };

  await setFlash("memberDeleted");
  redirect("/admin/members");
}

// Nothing on the page shows grants, so there is nothing to refresh.
export async function createResetLink(
  _prev: ResetLinkState,
  formData: FormData,
): Promise<ResetLinkState> {
  const viewer = await requireOrganizer();
  const parsed = memberIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };
  if (parsed.data.id === viewer.id) return { formError: "self" };

  const { token, tokenHash } = createLinkToken();
  let outcome: ResetGrantOutcome;
  try {
    outcome = await insertResetGrant({
      userId: parsed.data.id,
      createdById: viewer.id,
      tokenHash,
    });
  } catch (error) {
    reportUnexpected("createResetLink", error);
    return { formError: "unexpected" };
  }
  if (outcome.kind !== "created") return { formError: "stale" };

  return {
    created: {
      url: `${new URL(env.APP_URL).origin}/reset/${token}`,
      note: outcome.displayName,
    },
  };
}
