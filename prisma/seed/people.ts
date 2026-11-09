import { createCredentialUser, setCredentialPassword } from "@/db/credentials";
import type {
  MemberStatus,
  PrismaClient,
  Role,
} from "@/generated/prisma/client";

// Dev/test only: prisma/seed.ts refuses unless DEMO_SEED_DB_HOST names the target host.
export const SEED_EMAIL_DOMAIN = "elm-street.test";
export const DEMO_PASSWORD = "elm-street-demo";

export type SeedPerson = {
  name: string;
  email: string;
  role: Role;
  status: MemberStatus;
  area: string;
  contactDetails: string | null;
};

const email = (local: string) => `${local}@${SEED_EMAIL_DOMAIN}`;

export const SEED_PEOPLE: readonly SeedPerson[] = [
  {
    name: "Ruth K.",
    email: email("ruth"),
    role: "organizer",
    status: "active",
    area: "Elm Street, north end",
    contactDetails: "Phone 555 0101\nRing the side gate bell",
  },
  {
    name: "Marko J.",
    email: email("marko"),
    role: "organizer",
    status: "active",
    area: "Elm Street, by the bakery",
    contactDetails: "Phone 555 0102",
  },
  {
    name: "Ana P.",
    email: email("ana"),
    role: "member",
    status: "active",
    area: "Oak Lane",
    contactDetails: "Phone 555 0103\nEvenings after 6 work best",
  },
  {
    name: "Tom B.",
    email: email("tom"),
    role: "member",
    status: "active",
    area: "Elm Street, south end",
    contactDetails: "Phone 555 0104",
  },
  {
    name: "Lena S.",
    email: email("lena"),
    role: "member",
    status: "active",
    area: "Birch Court",
    contactDetails: "Flat 4, Birch Court\nPhone 555 0105",
  },
  {
    name: "Dev R.",
    email: email("dev"),
    role: "member",
    status: "active",
    area: "Oak Lane",
    contactDetails: "Phone 555 0106",
  },
  {
    name: "Ivo M.",
    email: email("ivo"),
    role: "member",
    status: "active",
    area: "Birch Court",
    contactDetails: null,
  },
  {
    name: "Sara L.",
    email: email("sara"),
    role: "member",
    status: "active",
    area: "Elm Street, by the school",
    contactDetails: "Phone 555 0108",
  },
  {
    name: "Nick D.",
    email: email("nick"),
    role: "member",
    status: "suspended",
    area: "Oak Lane",
    contactDetails: "Phone 555 0109",
  },
];

// Converges each person to the seeded values; never deletes anyone.
export async function seedPeople(
  client: PrismaClient,
  people: readonly SeedPerson[] = SEED_PEOPLE,
): Promise<void> {
  const outsider = people.find(
    (person) => !person.email.endsWith(`@${SEED_EMAIL_DOMAIN}`),
  );
  if (outsider) {
    throw new Error(`Seed people must use @${SEED_EMAIL_DOMAIN}`);
  }
  for (const person of people) {
    await client.$transaction(
      async (tx) => {
        const existing = await tx.user.findUnique({
          where: { email: person.email },
          select: { id: true },
        });
        if (!existing) {
          await createCredentialUser(tx, {
            ...person,
            password: DEMO_PASSWORD,
          });
          return;
        }
        await tx.user.update({
          where: { id: existing.id },
          data: {
            name: person.name,
            role: person.role,
            status: person.status,
            area: person.area,
            contactDetails: person.contactDetails,
          },
        });
        await setCredentialPassword(tx, existing.id, DEMO_PASSWORD);
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
  }
}
