import { createScriptClient } from "../../scripts/lib/script-db";
import { failureLine } from "../../scripts/lib/cli";
import {
  cleanupRun,
  countLoansOnItem,
  countRunRows,
  createInteractiveLoans,
  missingPrerequisite,
  noEligibleBorrower,
  pickInteractiveTargets,
  pickResponsiveTargets,
  pickSeedBorrower,
} from "./db";

// One database step per run, under tsx (see db-call.ts). Prints the result as
// JSON; a failure prints only failureLine's class and code.

type Args = Record<string, unknown>;

const commands: Record<
  string,
  (
    client: ReturnType<typeof createScriptClient>,
    args: Args,
  ) => Promise<unknown>
> = {
  async prepare(client, { today }) {
    const missing = await missingPrerequisite(client);
    if (missing) return { fix: missing };
    const borrower = await pickSeedBorrower(client, String(today));
    return borrower ? { borrower } : { fix: noEligibleBorrower() };
  },
  "responsive-targets"(client, { organizerEmail, today }) {
    return pickResponsiveTargets(client, String(organizerEmail), String(today));
  },
  "interactive-targets"(client, { organizerEmail, memberEmail, tag, today }) {
    return pickInteractiveTargets(client, {
      organizerEmail: String(organizerEmail),
      memberEmail: String(memberEmail),
      tag: String(tag),
      today: String(today),
    });
  },
  "interactive-loans"(client, { tag, ownerEmail, seedBorrowerEmail, today }) {
    return createInteractiveLoans(client, {
      tag: String(tag),
      ownerEmail: String(ownerEmail),
      seedBorrowerEmail: String(seedBorrowerEmail),
      today: String(today),
    });
  },
  async "count-loans"(client, { itemId }) {
    return { count: await countLoansOnItem(client, String(itemId)) };
  },
  async cleanup(client, { tag, addresses }) {
    await cleanupRun(client, String(tag), addresses as string[]);
    return countRunRows(client, String(tag));
  },
};

async function main() {
  const [command = "", rawArgs = "{}"] = process.argv.slice(2);
  const run = commands[command];
  if (!run) throw new Error(`Unknown e2e database command: ${command}`);
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED is unset.");
  const client = createScriptClient(url);
  try {
    process.stdout.write(
      JSON.stringify(await run(client, JSON.parse(rawArgs))),
    );
  } finally {
    await client.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(failureLine(error));
  process.exitCode = 1;
});
