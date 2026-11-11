import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import { parseEnv } from "@/lib/env/parse";
import { categoriesScriptEnvSchema } from "@/lib/schemas/bootstrap";
import { ensureCategories } from "./lib/categories";
import { failureLine, hostOf } from "./lib/cli";
import { createScriptClient } from "./lib/script-db";

// Loads no env file: pass one with `npx tsx --env-file=<file> scripts/seed-categories.ts`.
// A live deployment's cached list picks the rows up within a day, or on the next deploy.
async function main(): Promise<number> {
  let url;
  try {
    url = parseEnv(
      categoriesScriptEnvSchema,
      process.env,
    ).DATABASE_URL_UNPOOLED;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  console.log(`Database host: ${hostOf(url)}`);

  const client = createScriptClient(url);
  try {
    const { created, existing } = await ensureCategories(
      client,
      PRODUCTION_CATEGORIES,
    );
    console.log(`Created: ${created}`);
    console.log(`Already present: ${existing}`);
    return 0;
  } catch (error) {
    console.error(failureLine(error));
    return 3;
  } finally {
    await client.$disconnect();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(failureLine(error));
    process.exitCode = 3;
  },
);
