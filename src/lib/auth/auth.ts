import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getMemberStatus } from "@/data/members";
import { db } from "@/db";
import { authSchemaOptions } from "@/lib/auth/schema-options";
import { env } from "@/lib/env/server";

export const auth = betterAuth({
  ...authSchemaOptions,
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: env.AUTH_SECRET,
  baseURL: env.APP_URL,
  // Names change through updateProfile (profileSchema), never the library.
  disabledPaths: ["/update-user"],
  hooks: {
    // A password change always ends every other session (changePassword
    // sends the flag); a direct call to the library can't skip it.
    before: createAuthMiddleware(async (ctx) => {
      if (
        ctx.path === "/change-password" &&
        ctx.body?.revokeOtherSessions !== true
      ) {
        throw new APIError("BAD_REQUEST", {
          code: "REVOKE_OTHER_SESSIONS_REQUIRED",
          message: "revokeOtherSessions must be true",
        });
      }
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Sign-in creates the session only after the password checks out, so a
        // suspended member learns it only with the right password.
        before: async (session) => {
          if ((await getMemberStatus(session.userId)) === "suspended") {
            throw new APIError("FORBIDDEN", { code: "ACCOUNT_SUSPENDED" });
          }
        },
      },
    },
  },
  plugins: [nextCookies()],
});
