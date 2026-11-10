import "server-only";
import { db } from "@/db";
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

// Spec 09 adds the clauses (and the client + user id they query with): a
// Listed item, or an open, approved or out loan on either side (effective
// status). Until then nothing depends on the details.
async function isContactDetailsLocked(): Promise<boolean> {
  return false;
}

export async function getAccount(userId: string): Promise<AccountDTO> {
  const [row, locked] = await Promise.all([
    db.user.findUniqueOrThrow({ where: { id: userId }, select: accountSelect }),
    isContactDetailsLocked(),
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

// The lock check and the write share one transaction: listing an item (10) and
// requesting a loan (13) read the details inside theirs.
export async function updateOwnContactDetails(
  userId: string,
  contactDetails: string | null,
): Promise<"saved" | "locked"> {
  return db.$transaction(async (tx) => {
    if (contactDetails === null && (await isContactDetailsLocked())) {
      return "locked";
    }
    await tx.user.update({ where: { id: userId }, data: { contactDetails } });
    return "saved";
  });
}
