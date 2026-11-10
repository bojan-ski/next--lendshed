import { z } from "zod";
import { joinTokenSchema } from "@/lib/schemas/invitations";
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN } from "@/lib/schemas/limits";
import { resetPassword } from "@/strings/resetPassword";

// Anything but a single string no longer than a name searches for nothing.
export const memberSearchSchema = z.object({
  q: z.string().trim().max(NAME_MAX).catch(""),
});

export const memberIdSchema = z.object({
  id: z.string().min(1),
});

// A malformed token is a broken link, never a field error.
export const resetPasswordSchema = joinTokenSchema.extend({
  password: z
    .string({ error: resetPassword.passwordTooShort })
    .min(PASSWORD_MIN, { error: resetPassword.passwordTooShort })
    .max(PASSWORD_MAX, { error: resetPassword.passwordTooLong }),
});

export type MemberSearch = z.infer<typeof memberSearchSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
