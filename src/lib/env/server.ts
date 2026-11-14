import "server-only";
import { z } from "zod";
import { parseEnv } from "@/lib/env/parse";

// `.env.example` ships these keys empty: an empty value counts as absent.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    schema.optional(),
  );

export const serverEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    DATABASE_URL: z.url(),
    DATABASE_URL_UNPOOLED: z.url(),
    COMMUNITY_NAME: z.string().trim().min(1),
    AUTH_SECRET: z.string().min(32),
    APP_URL: z.url(),
    STORAGE_DRIVER: z.enum(["blob", "disk"]),
    BLOB_READ_WRITE_TOKEN: optional(z.string().min(1)),
    BLOB_PUBLIC_HOST: optional(
      z.string().regex(/^[a-z0-9-]+\.public\.blob\.vercel-storage\.com$/),
    ),
    CRON_SECRET: optional(z.string().min(32)),
    VERCEL: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    // A deployment never runs an unguarded daily job.
    if (value.VERCEL === "1" && value.CRON_SECRET === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["CRON_SECRET"],
        message: "required on Vercel",
      });
    }
    if (value.STORAGE_DRIVER === "disk") {
      // A deployment's disk is neither shared nor kept: files would vanish.
      if (value.VERCEL === "1") {
        ctx.addIssue({
          code: "custom",
          path: ["STORAGE_DRIVER"],
          message: "disk on Vercel",
        });
      }
      return;
    }
    for (const name of ["BLOB_READ_WRITE_TOKEN", "BLOB_PUBLIC_HOST"] as const) {
      if (value[name] === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [name],
          message: "required with blob",
        });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export const env: ServerEnv = parseEnv(serverEnvSchema, process.env);
