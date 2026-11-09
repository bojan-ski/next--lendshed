import { createCredentialUser } from "@/db/credentials";
import {
  Prisma,
  type MemberStatus,
  type PrismaClient,
  type Role,
} from "@/generated/prisma/client";

// activeOrganizerCount: active organizers other than this email.
export type BootstrapResult =
  | {
      outcome: "created" | "already_organizer";
      userId: string;
      activeOrganizerCount: number;
    }
  | { outcome: "conflict"; userId: string; reason: "member" | "suspended" };

type BootstrapInput = { name: string; email: string; password: string };

type ExistingUser = { id: string; role: Role; status: MemberStatus };

const existingSelect = { id: true, role: true, status: true } as const;

function countOtherOrganizers(client: Prisma.TransactionClient, email: string) {
  return client.user.count({
    where: { role: "organizer", status: "active", NOT: { email } },
  });
}

async function outcomeFor(
  client: Prisma.TransactionClient,
  user: ExistingUser,
  email: string,
): Promise<BootstrapResult> {
  if (user.status === "suspended") {
    return { outcome: "conflict", userId: user.id, reason: "suspended" };
  }
  if (user.role === "member") {
    return { outcome: "conflict", userId: user.id, reason: "member" };
  }
  return {
    outcome: "already_organizer",
    userId: user.id,
    activeOrganizerCount: await countOtherOrganizers(client, email),
  };
}

// Idempotent: never overwrites an existing user, never writes a second one.
export async function bootstrapOrganizer(
  client: PrismaClient,
  input: BootstrapInput,
): Promise<BootstrapResult> {
  const email = input.email.trim().toLowerCase();
  try {
    return await client.$transaction(
      async (tx) => {
        const existing = await tx.user.findUnique({
          where: { email },
          select: existingSelect,
        });
        if (existing) return outcomeFor(tx, existing, email);
        const activeOrganizerCount = await countOtherOrganizers(tx, email);
        const { id } = await createCredentialUser(tx, {
          name: input.name,
          email,
          password: input.password,
          role: "organizer",
          status: "active",
        });
        return { outcome: "created", userId: id, activeOrganizerCount };
      },
      // scrypt runs inside; a cold Neon compute can outlast the 5 s default.
      { maxWait: 15_000, timeout: 30_000 },
    );
  } catch (error) {
    // A concurrent run created this email first: report that user instead.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const winner = await client.user.findUnique({
        where: { email },
        select: existingSelect,
      });
      if (winner) return outcomeFor(client, winner, email);
    }
    throw error;
  }
}
