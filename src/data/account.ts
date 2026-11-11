import "server-only";
import { db } from "@/db";
import { blockingLoanWhere, openLoanWhere } from "@/data/loan-scopes";
import type { Prisma } from "@/generated/prisma/client";
import type { AccountDTO } from "@/types/account";

const accountSelect = {
  name: true,
  email: true,
  area: true,
  contactDetails: true,
} satisfies Prisma.UserSelect;

type AccountRow = Prisma.UserGetPayload<{ select: typeof accountSelect }>;

export function toAccountDTO(row: AccountRow, locked: boolean): AccountDTO {
  return {
    displayName: row.name,
    area: row.area,
    contactDetails: row.contactDetails,
    email: row.email,
    contactDetailsLocked: locked,
  };
}

// The details can't be cleared while someone relies on them: a Listed item, or
// a live loan (open, approved, out or overdue) on either side.
async function isContactDetailsLocked(
  client: Prisma.TransactionClient,
  userId: string,
  today: string,
): Promise<boolean> {
  const [listed, live] = await Promise.all([
    client.item.count({
      where: { ownerId: userId, status: "listed" },
      take: 1,
    }),
    client.loan.count({
      where: {
        AND: [
          { OR: [openLoanWhere(today), blockingLoanWhere(today)] },
          { OR: [{ borrowerId: userId }, { item: { ownerId: userId } }] },
        ],
      },
      take: 1,
    }),
  ]);
  return listed > 0 || live > 0;
}

export async function getAccount(
  userId: string,
  today: string,
): Promise<AccountDTO> {
  const [row, locked] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: accountSelect }),
    isContactDetailsLocked(db, userId, today),
  ]);
  return toAccountDTO(row, locked);
}

export async function updateOwnProfile(
  userId: string,
  input: { name: string; area: string | null },
): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { name: input.name, area: input.area },
  });
}

// Own row first: listing an item (10) and requesting a loan (13) take it FOR
// SHARE before reading the details, so a clear runs before or after them,
// never beside. One own row only, so no organizer lock (rules/data.md).
export async function updateOwnContactDetails(
  userId: string,
  contactDetails: string | null,
  today: string,
): Promise<"saved" | "locked"> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${userId} FOR UPDATE`;
    if (
      contactDetails === null &&
      (await isContactDetailsLocked(tx, userId, today))
    ) {
      return "locked";
    }
    await tx.user.update({ where: { id: userId }, data: { contactDetails } });
    return "saved";
  });
}
