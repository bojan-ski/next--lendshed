import type { LoanStatus, PrismaClient } from "@/generated/prisma/client";
import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import { categoryNameKey } from "@/lib/categories/name";
import { addDays } from "@/lib/dates/dates";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { REQUEST_LIMITS } from "@/lib/loans/limits";
import {
  createDiskStorage,
  DISK_URL_PREFIX,
  diskStorageRoot,
} from "@/lib/storage/disk";
import { REQUIRED_MIGRATIONS } from "@/__tests__/support/required-migrations";
import { SEED_EMAIL_DOMAIN, SEED_PEOPLE } from "../../prisma/seed/people";
import { REVIEW_LOANS, reviewLoanMarker } from "../../prisma/seed/review-loans";
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

export type ResponsiveTargets =
  | {
      memberEmail: string;
      params: Record<string, Record<string, string>>;
      // The chosen loan's seen-at values, compared after the sweep: an
      // organizer who is no party must never write them.
      loanSeenAt: { owner: string | null; borrower: string | null };
    }
  | { fix: string };

const BLOCKS_RETIRE = new Set(["approved", "out", "overdue"]);

// The ids the 360 px sweep visits (spec 25), chosen by role and data, never by
// name. Read-only.
export async function pickResponsiveTargets(
  client: PrismaClient,
  organizerEmail: string,
  today: string,
): Promise<ResponsiveTargets> {
  const seedEmails = SEED_PEOPLE.map((person) => person.email);
  const members = await client.user.findMany({
    where: { email: { in: seedEmails }, role: "member", status: "active" },
    orderBy: { email: "asc" },
    select: {
      id: true,
      email: true,
      itemsOwned: {
        where: { status: { not: "retired" } },
        orderBy: { id: "asc" },
        select: {
          id: true,
          loans: { select: { status: true, startDate: true, endDate: true } },
        },
      },
    },
  });
  // Its Edit page then offers Delete or Retire.
  const free = (
    loans: { status: LoanStatus; startDate: Date; endDate: Date }[],
  ) =>
    loans.every(
      (loan) =>
        !BLOCKS_RETIRE.has(
          effectiveStatus(
            {
              status: loan.status,
              startDate: fromDbDate(loan.startDate),
              endDate: fromDbDate(loan.endDate),
            },
            today,
          ),
        ),
    );
  const member = members.find(({ itemsOwned }) =>
    itemsOwned.some(({ loans }) => free(loans)),
  );
  if (!member) {
    return {
      fix: `No active seed member owns an item free of approved or out loans. Run: ${SEED}`,
    };
  }
  const ownItem = member.itemsOwned.find(({ loans }) => free(loans))!;

  const listed = await client.item.findFirst({
    where: {
      status: "listed",
      ownerId: { not: member.id },
      owner: { email: { in: seedEmails }, status: "active" },
    },
    orderBy: { id: "asc" },
    select: { id: true, ownerId: true },
  });
  if (!listed?.ownerId) {
    return {
      fix: `No other active seed member has a Listed item. Run: ${SEED}`,
    };
  }

  const organizer = await client.user.findUnique({
    where: { email: organizerEmail },
    select: { id: true },
  });
  const loan = await client.loan.findFirst({
    where: {
      requestMessage: {
        in: REVIEW_LOANS.map(({ kind }) => reviewLoanMarker(kind)),
      },
      borrowerId: { not: organizer?.id },
      item: { ownerId: { not: organizer?.id } },
    },
    orderBy: { id: "asc" },
    select: { id: true, ownerSeenAt: true, borrowerSeenAt: true },
  });
  if (!organizer || !loan) {
    return { fix: `No review loan without the seed organizer. Run: ${SEED}` };
  }

  return {
    memberEmail: member.email,
    params: {
      "/my/items/[id]/edit": { id: ownItem.id },
      "/items/[id]": { id: listed.id },
      "/members/[id]": { id: listed.ownerId },
      "/loans/[id]": { id: loan.id },
      "/admin/members/[id]": { id: member.id },
    },
    loanSeenAt: {
      owner: loan.ownerSeenAt?.toISOString() ?? null,
      borrower: loan.borrowerSeenAt?.toISOString() ?? null,
    },
  };
}

export const countLoansOnItem = (client: PrismaClient, itemId: string) =>
  client.loan.count({ where: { itemId } });

const OCCUPYING = new Set(["out", "overdue"]);
const effective = (
  loan: { status: LoanStatus; startDate: Date; endDate: Date },
  today: string,
) =>
  effectiveStatus(
    {
      status: loan.status,
      startDate: fromDbDate(loan.startDate),
      endDate: fromDbDate(loan.endDate),
    },
    today,
  );

const loanDates = { status: true, startDate: true, endDate: true } as const;

// Nothing out and nothing held: their Delete account control is offered.
const deletable = (
  person: {
    itemsOwned: {
      loans: { status: LoanStatus; startDate: Date; endDate: Date }[];
    }[];
    loansBorrowed: { status: LoanStatus; startDate: Date; endDate: Date }[];
  },
  today: string,
) =>
  [...person.itemsOwned.flatMap(({ loans }) => loans), ...person.loansBorrowed]
    .map((loan) => effective(loan, today))
    .every((status) => !OCCUPYING.has(status));

export type InteractiveTargets =
  | {
      suspendedMemberId: string;
      organizerItemId: string;
      // The seed rows the sweep opens, compared after it: no state may write.
      fingerprint: string;
    }
  | { fix: string };

// The ids the interactive sweep (spec 26) needs beyond responsive-targets,
// chosen by role and data. Read-only.
export async function pickInteractiveTargets(
  client: PrismaClient,
  {
    organizerEmail,
    memberEmail,
    tag,
    today,
  }: {
    organizerEmail: string;
    memberEmail: string;
    tag: string;
    today: string;
  },
): Promise<InteractiveTargets> {
  const seedEmails = SEED_PEOPLE.map((person) => person.email);
  const footprint = {
    itemsOwned: { select: { loans: { select: loanDates } } },
    loansBorrowed: { select: loanDates },
  } as const;
  const member = await client.user.findUnique({
    where: { email: memberEmail },
    select: { name: true, area: true, role: true, status: true, ...footprint },
  });
  if (!member || !deletable(member, today)) {
    return {
      fix: `The sweep's member has an item out or is holding one, so Delete account isn't offered. Run: ${SEED}`,
    };
  }
  const suspended = (
    await client.user.findMany({
      where: { email: { in: seedEmails }, role: "member", status: "suspended" },
      orderBy: { email: "asc" },
      select: { id: true, role: true, status: true, ...footprint },
    })
  ).find((person) => deletable(person, today));
  if (!suspended) {
    return {
      fix: `No suspended seed member with nothing out or held. Run: ${SEED}`,
    };
  }
  const organizer = await client.user.findUnique({
    where: { email: organizerEmail },
    select: { id: true },
  });
  const item = organizer
    ? await client.item.findFirst({
        where: {
          status: "listed",
          ownerId: { not: organizer.id },
          owner: { email: { in: seedEmails }, status: "active" },
        },
        orderBy: { id: "asc" },
        select: { id: true },
      })
    : null;
  if (!item) {
    return {
      fix: `No Listed item of another active seed member. Run: ${SEED}`,
    };
  }

  const itemColumns = {
    id: true,
    status: true,
    retiredAt: true,
    retiredNote: true,
    retiredById: true,
    photoKey: true,
  } as const;
  const fingerprint = JSON.stringify({
    member: {
      name: member.name,
      area: member.area,
      role: member.role,
      status: member.status,
    },
    memberItems: await client.item.findMany({
      where: {
        owner: { email: memberEmail },
        NOT: { title: { startsWith: `${tag} ` } },
      },
      orderBy: { id: "asc" },
      select: itemColumns,
    }),
    suspended: { role: suspended.role, status: suspended.status },
    organizerItem: await client.item.findUnique({
      where: { id: item.id },
      select: itemColumns,
    }),
  });
  return {
    suspendedMemberId: suspended.id,
    organizerItemId: item.id,
    fingerprint,
  };
}

export const interactiveItemTitle = (tag: string) => `${tag} e2e sweep ladder`;

export type InteractiveLoans =
  { requestLoanId: string; approvedLoanId: string } | { fix: string };

// A run-titled Hidden item of the member with one requested and one approved
// loan (spec 26 states 10 and 11). The borrower is another active seed member
// with contact details, never the journey's seed borrower: this request stays
// until teardown and would count against their open-request limit.
export async function createInteractiveLoans(
  client: PrismaClient,
  {
    tag,
    ownerEmail,
    seedBorrowerEmail,
    today,
  }: {
    tag: string;
    ownerEmail: string;
    seedBorrowerEmail: string;
    today: string;
  },
): Promise<InteractiveLoans> {
  const owner = await client.user.findUnique({
    where: { email: ownerEmail },
    select: { id: true },
  });
  const borrower = await client.user.findFirst({
    where: {
      email: {
        in: SEED_PEOPLE.map((person) => person.email).filter(
          (email) => email !== ownerEmail && email !== seedBorrowerEmail,
        ),
      },
      role: "member",
      status: "active",
      contactDetails: { not: null },
    },
    orderBy: { email: "asc" },
    select: { id: true },
  });
  const category = await client.category.findUnique({
    where: { nameKey: categoryNameKey(PRODUCTION_CATEGORIES[0]) },
    select: { id: true },
  });
  if (!owner || !borrower || !category) {
    return {
      fix: `No other active seed member with contact details to borrow. Run: ${SEED}`,
    };
  }
  const item = await client.item.create({
    data: {
      ownerId: owner.id,
      categoryId: category.id,
      title: interactiveItemTitle(tag),
      description: "",
      condition: "good",
      maxLoanDays: 7,
    },
    select: { id: true },
  });
  const loan = (status: LoanStatus, start: number) =>
    client.loan.create({
      data: {
        itemId: item.id,
        borrowerId: borrower.id,
        status,
        startDate: toDbDay(addDays(today, start)),
        endDate: toDbDay(addDays(today, start + 2)),
      },
      select: { id: true },
    });
  const request = await loan("requested", 20);
  const approved = await loan("approved", 30);
  return { requestLoanId: request.id, approvedLoanId: approved.id };
}

const toDbDay = (date: string) => new Date(`${date}T00:00:00.000Z`);

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
