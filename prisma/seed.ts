import "dotenv/config";
import { failureLine, hostOf } from "../scripts/lib/cli";
import { createScriptClient } from "../scripts/lib/script-db";
import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import { parseEnv } from "@/lib/env/parse";
import { demoSeedEnvSchema } from "@/lib/schemas/bootstrap";
import { seedCategories } from "./seed/categories";
import { seedInvitations, SEED_INVITATION_NOTES } from "./seed/invitations";
import { seedItems, SEED_ITEMS } from "./seed/items";
import { seedPeople, SEED_PEOPLE } from "./seed/people";

// Dev/test demo data. Later domain seeders run after seedPeople, in order.
async function main(): Promise<number> {
  let url;
  try {
    url = parseEnv(demoSeedEnvSchema, process.env).DATABASE_URL_UNPOOLED;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`demo seed refused. ${reason}`);
    return 1;
  }

  console.log(`Database host: ${hostOf(url)}`);

  const client = createScriptClient(url);
  try {
    await seedPeople(client);
    console.log(`People: ${SEED_PEOPLE.length} seeded`);
    await seedInvitations(client);
    console.log(`Invitations: ${SEED_INVITATION_NOTES.length} open`);
    await seedCategories(client);
    console.log(`Categories: ${PRODUCTION_CATEGORIES.length} present`);
    await seedItems(client);
    console.log(`Items: ${SEED_ITEMS.length} present (Hidden)`);
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
