"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { resetPasswordThroughGrant } from "@/data/reset-grants";
import { hashLinkToken } from "@/lib/auth/link-tokens";
import { setFlash } from "@/lib/feedback/flash";
import { reportUnexpected } from "@/lib/feedback/report";
import { joinTokenSchema } from "@/lib/schemas/invitations";
import { resetPasswordSchema } from "@/lib/schemas/members";
import type { ResetOutcome, ResetPasswordState } from "@/types/auth";

// Public: the token is the credential. Every bad link gets the same state, and
// a malformed one never reaches the database.
export async function resetPasswordWithGrant(
  _prev: ResetPasswordState,
  formData: FormData,
): Promise<ResetPasswordState> {
  const tokenParsed = joinTokenSchema.safeParse({
    token: formData.get("token"),
  });
  if (!tokenParsed.success) return { linkBroken: true };

  const parsed = resetPasswordSchema.safeParse({
    token: tokenParsed.data.token,
    password: formData.get("password"),
  });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return { fieldErrors: { password: fieldErrors.password } };
  }

  let outcome: ResetOutcome;
  try {
    outcome = await resetPasswordThroughGrant({
      tokenHash: hashLinkToken(parsed.data.token),
      password: parsed.data.password,
    });
  } catch (error) {
    reportUnexpected("resetPasswordWithGrant", error);
    return { formError: "unexpected" };
  }
  if (outcome.kind === "invalidToken") return { linkBroken: true };

  await setFlash("passwordReset");
  redirect("/login");
}
