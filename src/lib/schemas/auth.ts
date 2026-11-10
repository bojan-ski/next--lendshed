import { z } from "zod";
import { safeNextPath } from "@/lib/auth/safe-next";
import { PASSWORD_MAX } from "@/lib/schemas/limits";
import { login } from "@/strings/login";

// No 10-character minimum here: sign-in must not tell anyone which passwords exist.
export const signInSchema = z.object({
  email: z
    .string({ error: login.emailRequired })
    .trim()
    .min(1, { error: login.emailRequired })
    .toLowerCase()
    .pipe(z.email({ error: login.emailInvalid })),
  password: z
    .string({ error: login.passwordRequired })
    .min(1, { error: login.passwordRequired })
    .max(PASSWORD_MAX, { error: login.passwordTooLong }),
  next: z.string().nullish().transform(safeNextPath),
});

export type SignInInput = z.infer<typeof signInSchema>;
