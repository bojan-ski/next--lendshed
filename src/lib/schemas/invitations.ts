import { z } from "zod";
import {
  NAME_MAX,
  NAME_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
} from "@/lib/schemas/limits";
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
    .min(NAME_MIN, { error: join.nameTooShort })
    .max(NAME_MAX, { error: join.nameTooLong }),
  email: z
    .string({ error: join.emailRequired })
    .trim()
    .min(1, { error: join.emailRequired })
    .toLowerCase()
    .pipe(z.email({ error: join.emailInvalid })),
  password: z
    .string({ error: join.passwordTooShort })
    .min(PASSWORD_MIN, { error: join.passwordTooShort })
    .max(PASSWORD_MAX, { error: join.passwordTooLong }),
  acceptHouseRules: z
    .literal("on", { error: join.houseRulesRequired })
    .transform(() => true as const),
});

export type InvitationInput = z.infer<typeof invitationSchema>;
export type JoinInput = z.infer<typeof joinSchema>;
