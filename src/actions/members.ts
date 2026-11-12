"use server";

import { refresh } from "next/cache";
import { changeMemberRole } from "@/data/members";
import { insertResetGrant } from "@/data/reset-grants";
import type { Role } from "@/generated/prisma/enums";
import { requireOrganizer } from "@/lib/auth/guards";
import { createLinkToken } from "@/lib/auth/link-tokens";
import { env } from "@/lib/env/server";
import { reportUnexpected } from "@/lib/feedback/report";
import { memberIdSchema } from "@/lib/schemas/members";
import type {
  ResetGrantOutcome,
  ResetLinkState,
  RoleChangeOutcome,
  RoleChangeState,
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
