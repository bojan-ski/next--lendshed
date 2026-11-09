import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { getMemberStatus } from "@/data/members";
import { db } from "@/db";
import { authSchemaOptions } from "@/lib/auth-schema-options";
import { env } from "@/lib/env";

export const auth = betterAuth({
  ...authSchemaOptions,
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: env.AUTH_SECRET,
  baseURL: env.APP_URL,
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
