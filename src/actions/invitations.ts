"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  insertInvitation,
  joinThroughInvitation,
  revokeOpenInvitation,
} from "@/data/invitations";
import { requireOrganizer } from "@/lib/auth/guards";
import { createLinkToken, hashLinkToken } from "@/lib/auth/link-tokens";
import { forwardSignIn } from "@/lib/auth/sign-in";
import { env } from "@/lib/env/server";
import { setFlash } from "@/lib/feedback/flash";
import { reportUnexpected } from "@/lib/feedback/report";
import {
  invitationIdSchema,
  invitationSchema,
  joinSchema,
  joinTokenSchema,
} from "@/lib/schemas/invitations";
import { join } from "@/strings/join";
import type { JoinOutcome, JoinState } from "@/types/auth";
import type {
  InvitationFormState,
  RevokeInvitationState,
} from "@/types/invitation";

export async function createInvitation(
  _prev: InvitationFormState,
  formData: FormData,
): Promise<InvitationFormState> {
  const viewer = await requireOrganizer();

  const parsed = invitationSchema.safeParse({ note: formData.get("note") });
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors };
  }

  const { token, tokenHash } = createLinkToken();
  let outcome: Awaited<ReturnType<typeof insertInvitation>>;
  try {
    outcome = await insertInvitation({
      tokenHash,
      note: parsed.data.note,
      createdById: viewer.id,
    });
  } catch (error) {
    reportUnexpected("createInvitation", error);
    return { formError: "unexpected" };
  }
  // Demoted or suspended since requireOrganizer(): nothing was written.
  if (outcome === "actorGone") return { formError: "stale" };

  refresh();
  return {
    created: {
      url: `${new URL(env.APP_URL).origin}/invite/${token}`,
      note: parsed.data.note,
    },
  };
}

export async function revokeInvitation(
  _prev: RevokeInvitationState,
  formData: FormData,
): Promise<RevokeInvitationState> {
  await requireOrganizer();
  const parsed = invitationIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { formError: "stale" };

  let result: Awaited<ReturnType<typeof revokeOpenInvitation>>;
  try {
    result = await revokeOpenInvitation(parsed.data.id);
  } catch (error) {
    reportUnexpected("revokeInvitation", error);
    return { formError: "unexpected" };
  }
  // A stale revoke keeps the row on screen so its notice is seen there.
  if (result === "notOpen") return { formError: "stale" };

  refresh();
  return { flash: "invitationRevoked" };
}

// Public: the token is the credential. Every bad link gets the same state.
export async function joinWithInvitation(
  _prev: JoinState,
  formData: FormData,
): Promise<JoinState> {
  const tokenParsed = joinTokenSchema.safeParse({
    token: formData.get("token"),
  });
  if (!tokenParsed.success) return { linkBroken: true };

  const rawName = formData.get("name");
  const rawEmail = formData.get("email");
  const echo = {
    name: typeof rawName === "string" ? rawName : undefined,
    email: typeof rawEmail === "string" ? rawEmail : undefined,
  };

  const parsed = joinSchema.safeParse({
    token: tokenParsed.data.token,
    name: rawName,
    email: rawEmail,
    password: formData.get("password"),
    acceptHouseRules: formData.get("acceptHouseRules") ?? undefined,
  });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      fieldErrors: {
        name: fieldErrors.name,
        email: fieldErrors.email,
        password: fieldErrors.password,
        acceptHouseRules: fieldErrors.acceptHouseRules,
      },
      ...echo,
    };
  }

  const { token, name, email, password } = parsed.data;
  let outcome: JoinOutcome;
  try {
    outcome = await joinThroughInvitation({
      tokenHash: hashLinkToken(token),
      name,
      email,
      password,
    });
  } catch (error) {
    reportUnexpected("joinWithInvitation", error);
    return { formError: "unexpected", ...echo };
  }
  if (outcome.kind === "invalidToken") return { linkBroken: true };
  if (outcome.kind === "emailTaken") {
    return { fieldErrors: { email: [join.emailTaken] }, ...echo };
  }

  // The account exists and the link is used: a refused sign-in only changes
  // where the new member lands, never claims again.
  const signInRefused = await forwardSignIn(email, password);
  await setFlash(signInRefused ? "joinedSignIn" : "joined");
  redirect(signInRefused ? "/login" : "/");
}
