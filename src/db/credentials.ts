import { randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import type { MemberStatus, Prisma, Role } from "@/generated/prisma/client";

// The one way to create a password user. No `server-only`: the CLI scripts
// load this module too. Never import it from a client component.

export type CredentialClient = Prisma.TransactionClient;

export type CredentialUserInput = {
  name: string;
  email: string;
  password: string;
  role?: Role;
  status?: MemberStatus;
  area?: string | null;
  contactDetails?: string | null;
};

const CREDENTIAL_PROVIDER = "credential";

export async function createCredentialUser(
  client: CredentialClient,
  input: CredentialUserInput,
): Promise<{ id: string }> {
  const id = randomUUID();
  const password = await hashPassword(input.password);
  // One nested create is one statement: both rows or neither.
  await client.user.create({
    data: {
      id,
      name: input.name,
      email: input.email.trim().toLowerCase(),
      emailVerified: false,
      image: null,
      role: input.role ?? "member",
      status: input.status ?? "active",
      area: input.area ?? null,
      contactDetails: input.contactDetails ?? null,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: CREDENTIAL_PROVIDER,
          password,
        },
      },
    },
    select: { id: true },
  });
  return { id };
}

export async function setCredentialPassword(
  client: CredentialClient,
  userId: string,
  password: string,
): Promise<void> {
  const hash = await hashPassword(password);
  const updated = await client.account.updateMany({
    where: { userId, providerId: CREDENTIAL_PROVIDER },
    data: { password: hash },
  });
  if (updated.count > 0) return;
  await client.account.create({
    data: {
      id: randomUUID(),
      userId,
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER,
      password: hash,
    },
  });
}
