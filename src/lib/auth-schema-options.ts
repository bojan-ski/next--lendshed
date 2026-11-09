import type { BetterAuthOptions } from "better-auth";

// The options that shape the auth tables. No server-only, env or db import:
// the `auth` CLI loads this file through auth.cli.ts.
export const authSchemaOptions = {
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 10,
    maxPasswordLength: 128,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,
  },
  rateLimit: {
    enabled: true,
    storage: "database",
  },
  user: {
    additionalFields: {
      role: {
        type: ["member", "organizer"],
        defaultValue: "member",
        input: false,
      },
      status: {
        type: ["active", "suspended"],
        defaultValue: "active",
        input: false,
      },
      area: { type: "string", required: false, input: false },
      contactDetails: { type: "string", required: false, input: false },
    },
  },
} satisfies BetterAuthOptions;
