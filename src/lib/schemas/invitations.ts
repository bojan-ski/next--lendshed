import { z } from "zod";
import { invitations } from "@/strings/invitations";
import { join } from "@/strings/join";

export const invitationSchema = z.object({
  note: z
    .string()
    .trim()
    .max(80, { error: invitations.noteTooLong })
    .nullish()
    .transform((note) => note || null),
});

export const invitationIdSchema = z.object({
  id: z.string().min(1),
});

// A malformed token is a broken link, never a field error.
export const joinTokenSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});

export const joinSchema = joinTokenSchema.extend({
  name: z
    .string({ error: join.nameTooShort })
    .trim()
    .min(2, { error: join.nameTooShort })
    .max(40, { error: join.nameTooLong }),
  email: z
    .string({ error: join.emailRequired })
    .trim()
    .min(1, { error: join.emailRequired })
    .toLowerCase()
    .pipe(z.email({ error: join.emailInvalid })),
  password: z
    .string({ error: join.passwordTooShort })
    .min(10, { error: join.passwordTooShort })
    .max(128, { error: join.passwordTooLong }),
  acceptHouseRules: z
    .literal("on", { error: join.houseRulesRequired })
    .transform(() => true as const),
});

export type InvitationInput = z.infer<typeof invitationSchema>;
export type JoinInput = z.infer<typeof joinSchema>;
