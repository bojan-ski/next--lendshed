import { z } from "zod";
import { joinTokenSchema } from "@/lib/schemas/invitations";
import { resetPassword } from "@/strings/resetPassword";

// Anything but a single string of at most 40 characters searches for nothing.
export const memberSearchSchema = z.object({
  q: z.string().trim().max(40).catch(""),
});

export const memberIdSchema = z.object({
  id: z.string().min(1),
});

// A malformed token is a broken link, never a field error.
export const resetPasswordSchema = joinTokenSchema.extend({
  password: z
    .string({ error: resetPassword.passwordTooShort })
    .min(10, { error: resetPassword.passwordTooShort })
    .max(128, { error: resetPassword.passwordTooLong }),
});

export type MemberSearch = z.infer<typeof memberSearchSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
