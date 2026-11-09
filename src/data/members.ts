import "server-only";
import { db } from "@/db";
import type { MemberStatus } from "@/generated/prisma/client";

export async function getMemberStatus(
  userId: string,
): Promise<MemberStatus | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { status: true },
  });
  return user?.status ?? null;
}
