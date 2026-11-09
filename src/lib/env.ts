import "server-only";
import { z } from "zod";
import { parseEnv } from "@/lib/parse-env";

export const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url(),
  DATABASE_URL_UNPOOLED: z.url(),
  COMMUNITY_NAME: z.string().trim().min(1),
  AUTH_SECRET: z.string().min(32),
  APP_URL: z.url(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const env: ServerEnv = parseEnv(serverEnvSchema, process.env);
