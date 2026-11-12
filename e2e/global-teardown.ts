import { callDb } from "./support/db-call";
import { runAddresses, runTag } from "./support/run";

type RunRows = Record<"users" | "items" | "loans" | "invitations", number>;

// Runs whether the tests passed or not, and even when globalSetup failed
// before it tagged the run (then there is nothing to delete).
export default async function globalTeardown() {
  const tag = runTag();
  if (!tag) return;
  const left = callDb<RunRows>("cleanup", {
    tag,
    addresses: runAddresses(tag),
  });
  const counts = Object.entries(left).filter(([, count]) => count !== 0);
  if (counts.length > 0) {
    throw new Error(
      `e2e teardown left run rows: ${counts.map(([table, count]) => `${table} ${count}`).join(", ")}.`,
    );
  }
}
