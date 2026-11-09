import { parseEnv } from "@/lib/parse-env";
import { organizerBootstrapEnvSchema } from "@/lib/schemas/bootstrap";
import { bootstrapOrganizer } from "./lib/bootstrap-organizer";
import { failureLine, hostOf } from "./lib/cli";
import { createScriptClient } from "./lib/script-db";

// Loads no env file: pass one with `npx tsx --env-file=<file> scripts/bootstrap-organizer.ts`.
async function main(): Promise<number> {
  let input;
  try {
    input = parseEnv(organizerBootstrapEnvSchema, process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  console.log(`Database host: ${hostOf(input.DATABASE_URL_UNPOOLED)}`);
  console.log(`Organizer email: ${input.ORGANIZER_EMAIL}`);

  const client = createScriptClient(input.DATABASE_URL_UNPOOLED);
  try {
    const result = await bootstrapOrganizer(client, {
      name: input.ORGANIZER_NAME,
      email: input.ORGANIZER_EMAIL,
      password: input.ORGANIZER_PASSWORD,
    });
    if (result.outcome === "conflict") {
      console.log(`Outcome: conflict (${result.reason})`);
      console.log(
        result.reason === "member"
          ? "This email belongs to a member. Promote them in the app, or use another email."
          : "This email belongs to a suspended account. Reinstate it in the app, or use another email.",
      );
      return 2;
    }
    console.log(`Outcome: ${result.outcome}`);
    console.log(`Other active organizers: ${result.activeOrganizerCount}`);
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
