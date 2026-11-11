import type { ItemCondition, PrismaClient } from "@/generated/prisma/client";
import { categoryNameKey } from "@/lib/categories/name";
import { SEED_EMAIL_DOMAIN } from "./people";

export type SeedItem = {
  ownerEmail: string;
  category: string;
  title: string;
  condition: ItemCondition;
  maxLoanDays: number;
};

const owner = (local: string) => `${local}@${SEED_EMAIL_DOMAIN}`;

// Hidden with no photo until spec 11 gives them placeholders (OQ-15). Every
// category is used and every seed person owns one, the suspended one included.
export const SEED_ITEMS: readonly SeedItem[] = [
  {
    ownerEmail: owner("ruth"),
    category: "Tools",
    title: "Extension ladder",
    condition: "good",
    maxLoanDays: 5,
  },
  {
    ownerEmail: owner("ruth"),
    category: "Kids",
    title: "Travel cot",
    condition: "good",
    maxLoanDays: 14,
  },
  {
    ownerEmail: owner("marko"),
    category: "Garden",
    title: "Hedge trimmer",
    condition: "worn",
    maxLoanDays: 3,
  },
  {
    ownerEmail: owner("ana"),
    category: "Kitchen",
    title: "Stand mixer",
    condition: "good",
    maxLoanDays: 7,
  },
  {
    ownerEmail: owner("tom"),
    category: "Outdoors",
    title: "Two-person tent",
    condition: "good",
    maxLoanDays: 10,
  },
  {
    ownerEmail: owner("lena"),
    category: "Kids",
    title: "Baby carrier",
    condition: "good",
    maxLoanDays: 14,
  },
  {
    ownerEmail: owner("dev"),
    category: "Tools",
    title: "Cordless drill",
    condition: "new",
    maxLoanDays: 3,
  },
  {
    ownerEmail: owner("ivo"),
    category: "Garden",
    title: "Wheelbarrow",
    condition: "worn",
    maxLoanDays: 7,
  },
  {
    ownerEmail: owner("sara"),
    category: "Kitchen",
    title: "Pasta machine",
    condition: "needs_care",
    maxLoanDays: 7,
  },
  {
    ownerEmail: owner("nick"),
    category: "Outdoors",
    title: "Camping stove",
    condition: "good",
    maxLoanDays: 5,
  },
];

// Creates an item only when its owner has none with that title; existing rows
// are never changed or deleted.
export async function ensureItems(
  client: PrismaClient,
  entries: readonly SeedItem[],
): Promise<{ created: number; existing: number }> {
  let created = 0;
  for (const entry of entries) {
    const person = await client.user.findUnique({
      where: { email: entry.ownerEmail },
      select: { id: true },
    });
    if (!person) {
      throw new Error(
        `Seed item "${entry.title}": no member ${entry.ownerEmail}. Seed people first.`,
      );
    }
    const category = await client.category.findUnique({
      where: { nameKey: categoryNameKey(entry.category) },
      select: { id: true },
    });
    if (!category) {
      throw new Error(
        `Seed item "${entry.title}": no category ${entry.category}. Seed categories first.`,
      );
    }
    const existing = await client.item.findFirst({
      where: { ownerId: person.id, title: entry.title },
      select: { id: true },
    });
    if (existing) continue;
    await client.item.create({
      data: {
        ownerId: person.id,
        categoryId: category.id,
        title: entry.title,
        description: "",
        condition: entry.condition,
        maxLoanDays: entry.maxLoanDays,
      },
    });
    created += 1;
  }
  return { created, existing: entries.length - created };
}

export async function seedItems(client: PrismaClient): Promise<void> {
  await ensureItems(client, SEED_ITEMS);
}
