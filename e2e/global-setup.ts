import { communityToday } from "@/lib/dates/dates";
import { callDb } from "./support/db-call";
import { generateFixturePhoto } from "./support/photo";
import { newRunTag, startRun } from "./support/run";

type Prepared = { borrower: string } | { fix: string };

// Checks prerequisites only: never seeds, migrates or resets.
export default async function globalSetup() {
  const prepared = callDb<Prepared>("prepare", { today: communityToday() });
  if ("fix" in prepared) throw new Error(prepared.fix);
  startRun(newRunTag(), prepared.borrower);
  await generateFixturePhoto();
}
