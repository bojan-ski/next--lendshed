import { z } from "zod";
import { parseEnv } from "@/lib/env/parse";

export const publicEnvSchema = z.object({
  NEXT_PUBLIC_APP_NAME: z.string().trim().min(1),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export const publicEnv: PublicEnv = parseEnv(publicEnvSchema, {
  // Full literal so Next can inline it; never a dynamic process.env[key].
  NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
});
