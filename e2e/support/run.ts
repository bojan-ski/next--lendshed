import { createHash, randomBytes } from "node:crypto";
import { SEED_PEOPLE } from "../../prisma/seed/people";

// Runner-internal values set by globalSetup; never app variables.
const RUN_TAG = "E2E_RUN_TAG";
const SEED_BORROWER = "E2E_SEED_BORROWER";

export const ROLES = [
  "organizer",
  "lender",
  "borrower",
  "seedBorrower",
] as const;
export type Role = (typeof ROLES)[number];

export function newRunTag(): string {
  return `t${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
}

export function startRun(tag: string, seedBorrowerEmail: string): void {
  process.env[RUN_TAG] = tag;
  process.env[SEED_BORROWER] = seedBorrowerEmail;
}

// Set by globalSetup; tests see it only inside test(), so read it lazily.
export function runTag(): string | undefined {
  return process.env[RUN_TAG];
}

function requiredRunValue(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is unset: globalSetup did not run.`);
  return value;
}

export const currentTag = () => requiredRunValue(RUN_TAG);
export const seedBorrowerEmail = () => requiredRunValue(SEED_BORROWER);

export function seedOrganizer() {
  const organizer = SEED_PEOPLE.find(
    (person) => person.role === "organizer" && person.status === "active",
  );
  if (!organizer) throw new Error("SEED_PEOPLE has no active organizer.");
  return organizer;
}

export const runEmail = (tag: string, who: "lender" | "borrower") =>
  `${tag}-${who}@test.invalid`;
export const invitationNote = (
  tag: string,
  who: "lender" | "borrower" | "panel",
) => `${tag} e2e ${who}`;
export const itemTitle = (tag: string) => `${tag} e2e drill`;

// One TEST-NET-3 address per role, derived from the tag so teardown can
// recompute them; the four never collide.
export function addressOf(tag: string, role: Role): string {
  const base = createHash("sha256").update(tag).digest()[0] % 60;
  return `203.0.113.${1 + base * 4 + ROLES.indexOf(role)}`;
}

export const runAddresses = (tag: string) =>
  ROLES.map((role) => addressOf(tag, role));
