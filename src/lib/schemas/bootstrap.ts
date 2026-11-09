import { z } from "zod";

// Parsed from process.env by the CLI scripts, never by the app.
export const organizerBootstrapEnvSchema = z.object({
  DATABASE_URL_UNPOOLED: z.url(),
  ORGANIZER_NAME: z.string().trim().min(2).max(40),
  ORGANIZER_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  ORGANIZER_PASSWORD: z.string().min(10).max(128),
});

// The seed runs only against the one database host named here (set in .env.test only).
export const demoSeedEnvSchema = z
  .object({
    DATABASE_URL_UNPOOLED: z.url(),
    DEMO_SEED_DB_HOST: z.string().trim().toLowerCase().min(1),
  })
  .refine(
    (env) =>
      new URL(env.DATABASE_URL_UNPOOLED).hostname === env.DEMO_SEED_DB_HOST,
    { path: ["DEMO_SEED_DB_HOST"] },
  );

export type OrganizerBootstrapEnv = z.infer<typeof organizerBootstrapEnvSchema>;
