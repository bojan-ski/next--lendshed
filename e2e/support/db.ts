import type { PrismaClient } from "@/generated/prisma/client";
import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import { categoryNameKey } from "@/lib/categories/name";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { REQUEST_LIMITS } from "@/lib/loans/limits";
import {
  createDiskStorage,
  DISK_URL_PREFIX,
  diskStorageRoot,
} from "@/lib/storage/disk";
import { REQUIRED_MIGRATIONS } from "@/__tests__/support/required-migrations";
import { SEED_EMAIL_DOMAIN, SEED_PEOPLE } from "../../prisma/seed/people";
import { seedOrganizer } from "./run";

// Loaded only in the tsx child (db-cli.ts): the generated client can't load
// under Playwright's CommonJS transform.

const MIGRATE = "DOTENV_CONFIG_PATH=.env.test npx prisma migrate deploy";
const SEED = "DOTENV_CONFIG_PATH=.env.test npm run db:seed";

// The @db.Date value as the community date it stores (the inverse of toDbDate).
const fromDbDate = (value: Date) => value.toISOString().slice(0, 10);

export async function missingPrerequisite(
  client: PrismaClient,
): Promise<string | null> {
  const applied = await client.$queryRaw<{ migration_name: string }[]>`
    SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`;
  for (const name of REQUIRED_MIGRATIONS) {
    if (!applied.some((row) => row.migration_name.endsWith(`_${name}`))) {
      return `The test database is missing the \`${name}\` migration. Run: ${MIGRATE}`;
    }
  }

  const organizer = await client.user.findUnique({
    where: { email: seedOrganizer().email },
    select: {
      status: true,
      accounts: { where: { providerId: "credential" }, select: { id: true } },
    },
  });
  if (organizer?.status !== "active" || organizer.accounts.length === 0) {
    return `The seed organizer is missing or can't sign in. Run: ${SEED}`;
  }

  const categories = await client.category.count({
    where: { nameKey: { in: PRODUCTION_CATEGORIES.map(categoryNameKey) } },
  });
  if (categories !== PRODUCTION_CATEGORIES.length) {
    return `A production category is missing. Run: ${SEED}`;
  }
  return null;
}

// An active seed member with contact details and room for one more request,
// chosen by role and data, never by name.
export async function pickSeedBorrower(
  client: PrismaClient,
  today: string,
): Promise<string | null> {
  const members = await client.user.findMany({
    where: {
      email: { in: SEED_PEOPLE.map((person) => person.email) },
      role: "member",
      status: "active",
      contactDetails: { not: null },
    },
    orderBy: { email: "asc" },
    select: {
      email: true,
      loansBorrowed: {
        where: { status: "requested" },
        select: { status: true, startDate: true, endDate: true },
      },
    },
  });
  const eligible = members.find(
    ({ loansBorrowed }) =>
      loansBorrowed.filter(
        (loan) =>
          effectiveStatus(
            {
              status: loan.status,
              startDate: fromDbDate(loan.startDate),
              endDate: fromDbDate(loan.endDate),
            },
            today,
          ) === "requested",
      ).length < REQUEST_LIMITS.overall,
  );
  return eligible?.email ?? null;
}

export const noEligibleBorrower = () =>
  `No active seed member with contact details has room for a request. Run: ${SEED}`;

export const countLoansOnItem = (client: PrismaClient, itemId: string) =>
  client.loan.count({ where: { itemId } });

const runUsers = (tag: string) => ({ email: { startsWith: `${tag}-` } });
const runItems = (tag: string) => ({
  OR: [{ title: { startsWith: `${tag} ` } }, { owner: runUsers(tag) }],
});
const runInvitations = (tag: string) => ({ note: { startsWith: `${tag} ` } });

// Deletes exactly this run's rows, in the order the foreign keys need; never
// a seed row or another run's row.
export async function cleanupRun(
  client: PrismaClient,
  tag: string,
  addresses: readonly string[],
): Promise<void> {
  await client.invitation.deleteMany({ where: runInvitations(tag) });
  await client.loan.deleteMany({
    where: { OR: [{ item: runItems(tag) }, { borrower: runUsers(tag) }] },
  });

  const items = await client.item.findMany({
    where: runItems(tag),
    select: { photoKey: true },
  });
  const keys = items.flatMap(({ photoKey }) => (photoKey ? [photoKey] : []));
  await client.item.deleteMany({ where: runItems(tag) });
  // Upload rows would outlive their users (SetNull) and count against the cap.
  await client.uploadLog.deleteMany({ where: { user: runUsers(tag) } });
  await client.pendingBlobDeletion.deleteMany({
    where: { storageKey: { in: keys } },
  });
  const storage = createDiskStorage({
    root: diskStorageRoot(),
    urlPrefix: DISK_URL_PREFIX,
  });
  for (const key of keys) await storage.delete(key);

  await client.session.deleteMany({
    where: {
      ipAddress: { in: [...addresses] },
      user: { email: { endsWith: `@${SEED_EMAIL_DOMAIN}` } },
    },
  });

  // Active organizers first, then the run's users, both in id order: the
  // lockActiveOrganizerIds rule (.claude/rules/data.md).
  await client.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM "user"
        WHERE role = 'organizer' AND status = 'active'
        ORDER BY id
        FOR UPDATE`;
      const own = await tx.user.findMany({
        where: runUsers(tag),
        select: { id: true },
        orderBy: { id: "asc" },
      });
      const ids = own.map(({ id }) => id);
      await tx.$queryRaw`
        SELECT id FROM "user" WHERE id = ANY(${ids}) ORDER BY id FOR UPDATE`;
      await tx.user.deleteMany({ where: { id: { in: ids } } });
    },
    { maxWait: 15_000, timeout: 30_000 },
  );

  await client.rateLimit.deleteMany({
    where: { OR: addresses.map((ip) => ({ key: { startsWith: `${ip}|` } })) },
  });
}

export async function countRunRows(client: PrismaClient, tag: string) {
  const [users, items, loans, invitations] = await Promise.all([
    client.user.count({ where: runUsers(tag) }),
    client.item.count({ where: runItems(tag) }),
    client.loan.count({
      where: { OR: [{ item: runItems(tag) }, { borrower: runUsers(tag) }] },
    }),
    client.invitation.count({ where: runInvitations(tag) }),
  ]);
  return { users, items, loans, invitations };
}
