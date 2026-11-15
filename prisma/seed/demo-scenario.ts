import type {
  ItemCondition,
  LoanActor,
  LoanStatus,
  LoanSystemReason,
  PrismaClient,
  ReturnedAsLent,
} from "@/generated/prisma/client";
import { categoryNameKey } from "@/lib/categories/name";
import { addDays, communityToday } from "@/lib/dates/dates";
import { SEED_EMAIL_DOMAIN } from "./people";

export type DemoScenarioKind =
  | "declined"
  | "cancelled"
  | "owner-suspended"
  | "organizer-closed"
  | "owner-retired"
  | "organizer-retired"
  | "former-borrower"
  | "former-owner";

// A seed item, found by owner + title; never created or changed here.
export type DemoSeedItem = { ownerEmail: string; title: string };

// A retired item the scenario owns, found by owner + title (or by title with no
// owner). Never photographed or listed.
export type DemoScenarioItem = {
  ownerEmail: string | null;
  title: string;
  category: string;
  condition: ItemCondition;
  maxLoanDays: number;
  description: string;
  retiredOffset: number;
};

export type DemoScenarioEntry = {
  kind: DemoScenarioKind;
  item: DemoSeedItem | DemoScenarioItem;
  borrowerEmail: string | null;
  // The organizer who closes the loan or retires the item.
  organizerEmail?: string;
  startOffset: number;
  endOffset: number;
  returnedOffset?: number;
  // The decline, cancel or close reason; the organizer's retire note.
  note?: string;
};

const person = (local: string) => `${local}@${SEED_EMAIL_DOMAIN}`;

// The Stage E end states the review loans can't show, all ended over a week
// ago (Past groups, outside the contact window). Every loan is terminal, so the
// exclusion constraint never applies.
export const DEMO_SCENARIO: readonly DemoScenarioEntry[] = [
  {
    kind: "declined",
    item: { ownerEmail: person("tom"), title: "Two-person tent" },
    borrowerEmail: person("lena"),
    startOffset: -30,
    endOffset: -28,
    note: "Sorry, we're taking it camping that weekend.",
  },
  {
    kind: "cancelled",
    item: { ownerEmail: person("sara"), title: "Pasta machine" },
    borrowerEmail: person("dev"),
    startOffset: -26,
    endOffset: -24,
    note: "Plans changed, I don't need it after all.",
  },
  {
    kind: "owner-suspended",
    item: { ownerEmail: person("nick"), title: "Camping stove" },
    borrowerEmail: person("tom"),
    startOffset: -22,
    endOffset: -20,
  },
  {
    kind: "organizer-closed",
    item: { ownerEmail: person("lena"), title: "Baby carrier" },
    borrowerEmail: person("sara"),
    organizerEmail: person("marko"),
    startOffset: -40,
    endOffset: -35,
    returnedOffset: -33,
    note: "Sara brought it back while Lena was away; Lena confirmed by phone.",
  },
  {
    kind: "owner-retired",
    item: {
      ownerEmail: person("dev"),
      title: "Tile cutter",
      category: "Tools",
      condition: "worn",
      maxLoanDays: 3,
      description: "Manual tile cutter for tiles up to 60 cm.",
      retiredOffset: -45,
    },
    borrowerEmail: person("ana"),
    startOffset: -49,
    endOffset: -47,
  },
  {
    kind: "organizer-retired",
    item: {
      ownerEmail: person("tom"),
      title: "Pressure washer",
      category: "Garden",
      condition: "good",
      maxLoanDays: 2,
      description: "Electric pressure washer with a patio brush.",
      retiredOffset: -19,
    },
    borrowerEmail: person("sara"),
    organizerEmail: person("ruth"),
    startOffset: -16,
    endOffset: -15,
    note: "Its hose split and it sprays everywhere. Retired until it's repaired.",
  },
  {
    kind: "former-borrower",
    item: { ownerEmail: person("marko"), title: "Hedge trimmer" },
    borrowerEmail: null,
    startOffset: -60,
    endOffset: -58,
  },
  {
    kind: "former-owner",
    item: {
      ownerEmail: null,
      title: "Sewing machine",
      category: "Tools",
      condition: "good",
      maxLoanDays: 7,
      description: "Basic sewing machine with a spare needle set.",
      retiredOffset: -62,
    },
    borrowerEmail: person("lena"),
    startOffset: -70,
    endOffset: -66,
  },
];

export const demoScenarioMarker = (kind: DemoScenarioKind) =>
  `demo-scenario:${kind}`;

// The @db.Date value toDbDate builds; that module is server-only.
const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

const isScenarioItem = (
  item: DemoSeedItem | DemoScenarioItem,
): item is DemoScenarioItem => "category" in item;

type Person = { id: string; role: string; status: string };

type LoanColumns = {
  status: LoanStatus;
  statusReason: string | null;
  endedBy: LoanActor | null;
  systemReason: LoanSystemReason | null;
  returnedOn: Date | null;
  returnedAsLent: ReturnedAsLent | null;
  closedById: string | null;
};

const ENDED = {
  statusReason: null,
  endedBy: null,
  systemReason: null,
  returnedOn: null,
  returnedAsLent: null,
  closedById: null,
} as const;

function loanColumns(
  entry: DemoScenarioEntry,
  organizerId: string | null,
  today: string,
): LoanColumns {
  const returnedOn = dbDate(
    addDays(today, entry.returnedOffset ?? entry.endOffset),
  );
  const note = entry.note ?? null;
  switch (entry.kind) {
    case "declined":
      return {
        ...ENDED,
        status: "declined",
        endedBy: "owner",
        statusReason: note,
      };
    case "cancelled":
      return {
        ...ENDED,
        status: "cancelled",
        endedBy: "borrower",
        statusReason: note,
      };
    case "owner-suspended":
      return {
        ...ENDED,
        status: "declined",
        endedBy: "system",
        systemReason: "owner_suspended",
      };
    case "organizer-closed":
      return {
        ...ENDED,
        status: "returned",
        returnedOn,
        returnedAsLent: "unknown",
        statusReason: note,
        closedById: organizerId,
      };
    case "organizer-retired":
      return {
        ...ENDED,
        status: "cancelled",
        endedBy: "organizer",
        systemReason: "item_retired",
      };
    case "owner-retired":
    case "former-borrower":
    case "former-owner":
      return {
        ...ENDED,
        status: "returned",
        returnedOn,
        returnedAsLent: "yes",
      };
  }
}

// Converges each marked loan, and each scenario item, for `today`. Never
// deletes, and never touches a loan without its marker or an item without its
// key.
export async function ensureDemoScenario(
  client: PrismaClient,
  entries: readonly DemoScenarioEntry[],
  today: string,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  const people = new Map<string, Person>();
  const find = async (email: string, label: string): Promise<Person> => {
    const known = people.get(email);
    if (known) return known;
    const row = await client.user.findUnique({
      where: { email },
      select: { id: true, role: true, status: true },
    });
    if (!row)
      throw new Error(`${label}: no member ${email}. Seed people first.`);
    people.set(email, row);
    return row;
  };

  for (const entry of entries) {
    const label = `Demo scenario ${entry.kind} on "${entry.item.title}"`;
    const owner = entry.item.ownerEmail
      ? await find(entry.item.ownerEmail, label)
      : null;
    const borrower = entry.borrowerEmail
      ? await find(entry.borrowerEmail, label)
      : null;
    const organizer = entry.organizerEmail
      ? await find(entry.organizerEmail, label)
      : null;

    if (owner) {
      const wanted = entry.kind === "owner-suspended" ? "suspended" : "active";
      if (owner.status !== wanted) {
        throw new Error(`${label}: the owner must be ${wanted}.`);
      }
    }
    if (
      borrower &&
      (borrower.status !== "active" || borrower.id === owner?.id)
    ) {
      throw new Error(`${label}: the borrower must be another active member.`);
    }
    const needsOrganizer =
      entry.kind === "organizer-closed" || entry.kind === "organizer-retired";
    if (needsOrganizer !== Boolean(organizer)) {
      throw new Error(
        `${label}: ${needsOrganizer ? "needs" : "takes no"} organizer.`,
      );
    }
    if (
      organizer &&
      (organizer.role !== "organizer" ||
        organizer.status !== "active" ||
        organizer.id === owner?.id ||
        organizer.id === borrower?.id)
    ) {
      throw new Error(
        `${label}: the organizer must be an active organizer who is neither party.`,
      );
    }

    const itemId = isScenarioItem(entry.item)
      ? await convergeScenarioItem(client, entry.item, {
          label,
          ownerId: owner?.id ?? null,
          retiredById:
            entry.kind === "organizer-retired" ? (organizer?.id ?? null) : null,
          retiredNote:
            entry.kind === "organizer-retired" ? (entry.note ?? null) : null,
          today,
        })
      : await findSeedItem(client, owner!.id, entry.item.title, label);

    const requestMessage = demoScenarioMarker(entry.kind);
    const data = {
      ...loanColumns(entry, organizer?.id ?? null, today),
      borrowerId: borrower?.id ?? null,
      startDate: dbDate(addDays(today, entry.startOffset)),
      endDate: dbDate(addDays(today, entry.endOffset)),
      ownerSeenAt: null,
      borrowerSeenAt: null,
    };
    const existing = await client.loan.findFirst({
      where: { itemId, requestMessage },
      select: { id: true },
    });
    if (existing) {
      await client.loan.update({ where: { id: existing.id }, data });
      continue;
    }
    await client.loan.create({ data: { ...data, itemId, requestMessage } });
    created += 1;
  }
  return { created, updated: entries.length - created };
}

async function findSeedItem(
  client: PrismaClient,
  ownerId: string,
  title: string,
  label: string,
): Promise<string> {
  const item = await client.item.findFirst({
    where: { ownerId, title },
    select: { id: true },
  });
  if (!item) throw new Error(`${label}: no such item. Seed items first.`);
  return item.id;
}

async function convergeScenarioItem(
  client: PrismaClient,
  item: DemoScenarioItem,
  context: {
    label: string;
    ownerId: string | null;
    retiredById: string | null;
    retiredNote: string | null;
    today: string;
  },
): Promise<string> {
  const category = await client.category.findUnique({
    where: { nameKey: categoryNameKey(item.category) },
    select: { id: true },
  });
  if (!category) {
    throw new Error(
      `${context.label}: no category ${item.category}. Seed categories first.`,
    );
  }
  const data = {
    categoryId: category.id,
    description: item.description,
    condition: item.condition,
    maxLoanDays: item.maxLoanDays,
    pickupNotes: null,
    status: "retired" as const,
    listedAt: null,
    retiredAt: dbDate(addDays(context.today, item.retiredOffset)),
    retiredNote: context.retiredNote,
    retiredById: context.retiredById,
    photoKey: null,
    photoUrl: null,
    photoWidth: null,
    photoHeight: null,
    photoBytes: null,
  };
  const existing = await client.item.findFirst({
    where: { ownerId: context.ownerId, title: item.title },
    select: { id: true },
  });
  if (existing) {
    await client.item.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const { id } = await client.item.create({
    data: { ...data, ownerId: context.ownerId, title: item.title },
    select: { id: true },
  });
  return id;
}

export async function seedDemoScenario(
  client: PrismaClient,
  today: string = communityToday(),
): Promise<void> {
  await ensureDemoScenario(client, DEMO_SCENARIO, today);
}
