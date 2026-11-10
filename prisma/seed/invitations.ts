import { randomBytes } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { SEED_EMAIL_DOMAIN, SEED_PEOPLE } from "./people";

const DAY_MS = 24 * 60 * 60 * 1000;

// The review scenario for /admin/invitations: a short note, one at the 80-character
// limit (wrapping at 360 px), and one more so the list has several rows.
export const SEED_INVITATION_NOTES: readonly string[] = [
  "For Ana's neighbour",
  "For the family who moved into number 14, by the bakery end of Elm Street, in May",
  "For Tom's sister on Oak Lane",
];

const firstOrganizer = SEED_PEOPLE.find(({ role }) => role === "organizer");

// Keeps one open invitation per note from the organizer; never deletes and never
// touches a used, revoked or expired row. The hash has no token behind it, so no
// seeded invitation can ever be joined. Find-then-create, not an upsert: `note`
// isn't unique, and expired rows stay behind until spec 22's purge.
export async function seedInvitations(
  client: PrismaClient,
  {
    organizerEmail = firstOrganizer?.email,
    notes = SEED_INVITATION_NOTES,
  }: { organizerEmail?: string; notes?: readonly string[] } = {},
): Promise<void> {
  if (!organizerEmail?.endsWith(`@${SEED_EMAIL_DOMAIN}`)) {
    throw new Error(`Seed invitations need an @${SEED_EMAIL_DOMAIN} organizer`);
  }
  const organizer = await client.user.findUniqueOrThrow({
    where: { email: organizerEmail },
    select: { id: true },
  });
  const now = new Date();
  for (const note of notes) {
    const open = await client.invitation.findFirst({
      where: {
        note,
        createdById: organizer.id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: { id: true },
    });
    if (open) continue;
    await client.invitation.create({
      data: {
        tokenHash: randomBytes(32).toString("hex"),
        note,
        createdById: organizer.id,
        createdAt: now,
        expiresAt: new Date(now.getTime() + 7 * DAY_MS),
      },
    });
  }
}
