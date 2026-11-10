import { z } from "zod";
import {
  NAME_MAX,
  NAME_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
} from "@/lib/schemas/limits";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";

export const profileSchema = z.object({
  name: z
    .string({ error: account.nameTooShort })
    .trim()
    .min(NAME_MIN, { error: account.nameTooShort })
    .max(NAME_MAX, { error: account.nameTooLong }),
  area: z
    .string()
    .trim()
    .max(40, { error: account.areaTooLong })
    .nullish()
    .transform((area) => area || null),
});

// Browsers submit textarea line breaks as CRLF: normalise before counting, so
// a break never counts twice. Empty means clear.
export const contactDetailsSchema = z.object({
  contactDetails: z
    .string({ error: errors.actionFailed })
    .transform((text) => text.replace(/\r\n?/g, "\n"))
    .pipe(z.string().trim().max(300, { error: account.contactTooLong }))
    .transform((text) => text || null),
});

// Passwords are never trimmed; the current one has no 10-character minimum,
// as at sign-in.
export const changePasswordSchema = z.object({
  currentPassword: z
    .string({ error: account.currentPasswordRequired })
    .min(1, { error: account.currentPasswordRequired })
    .max(PASSWORD_MAX, { error: account.passwordTooLong }),
  newPassword: z
    .string({ error: account.passwordTooShort })
    .min(PASSWORD_MIN, { error: account.passwordTooShort })
    .max(PASSWORD_MAX, { error: account.passwordTooLong }),
});

export type ProfileInput = z.infer<typeof profileSchema>;
export type ContactDetailsInput = z.infer<typeof contactDetailsSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
