import "server-only";
import type { Prisma } from "@/generated/prisma/client";

// A waiting role change queues on the organizer locks inside its timeout.
export const ROLE_TRANSACTION = { maxWait: 15_000, timeout: 30_000 };

// Every organizer guard (role changes, suspension, links, close, retire) takes
// these locks first and in id order, so concurrent organizer actions
// serialise and the later one re-reads who is still an active organizer.
export async function lockActiveOrganizerIds(
  tx: Prisma.TransactionClient,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "user"
    WHERE role = 'organizer' AND status = 'active'
    ORDER BY id
    FOR UPDATE`;
  return rows.map(({ id }) => id);
}
