import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import { seedInvitations, SEED_INVITATION_NOTES } from "./invitations";
import { SEED_PEOPLE, seedPeople } from "./people";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

const DAY_MS = 24 * 60 * 60 * 1000;
const realOrganizer = SEED_PEOPLE.find(({ role }) => role === "organizer")!;

// A run-unique copy of the first seed organizer and tagged notes: tests never
// touch the real cast's invitations.
let copies = 0;
async function organizerCopy() {
  const person = {
    ...realOrganizer,
    email: `${scope.tag}c${++copies}-${realOrganizer.email}`,
  };
  await seedPeople(db, [person]);
  const { id } = await db.user.findUniqueOrThrow({
    where: { email: person.email },
    select: { id: true },
  });
  scope.track(id);
  const notes = SEED_INVITATION_NOTES.map(
    (note) => `${scope.tag}c${copies} ${note}`,
  );
  const seed = () =>
    seedInvitations(db, { organizerEmail: person.email, notes });
  return { id, notes, seed };
}

function invitationsBy(createdById: string) {
  return db.invitation.findMany({
    where: { createdById },
    orderBy: { createdAt: "asc" },
  });
}

const isOpen = (row: {
  usedAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date;
}) =>
  row.usedAt === null && row.revokedAt === null && row.expiresAt > new Date();

describe("seed invitation notes", () => {
  test("three distinct notes, one exactly at the 80-character limit", () => {
    expect(SEED_INVITATION_NOTES).toHaveLength(3);
    expect(new Set(SEED_INVITATION_NOTES).size).toBe(3);
    expect(SEED_INVITATION_NOTES.every((note) => note.length <= 80)).toBe(true);
    expect(
      SEED_INVITATION_NOTES.filter((note) => note.length === 80),
    ).toHaveLength(1);
  });
});

describe("seedInvitations", () => {
  test("creates one open, unjoinable invitation per note, 7 days long", async () => {
    const organizer = await organizerCopy();

    await organizer.seed();

    const rows = await invitationsBy(organizer.id);
    expect(rows.map(({ note }) => note).sort()).toEqual(
      [...organizer.notes].sort(),
    );
    for (const row of rows) {
      expect(isOpen(row)).toBe(true);
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(
        7 * DAY_MS,
      );
    }
  });

  test("a second run changes nothing", async () => {
    const organizer = await organizerCopy();
    await organizer.seed();
    const first = await invitationsBy(organizer.id);

    await organizer.seed();

    expect(await invitationsBy(organizer.id)).toEqual(first);
  });

  test("after a revoke, adds one new open row and leaves the revoked one as it was", async () => {
    const organizer = await organizerCopy();
    await organizer.seed();
    const [revoked, ...kept] = await invitationsBy(organizer.id);
    await db.invitation.update({
      where: { id: revoked.id },
      data: { revokedAt: new Date() },
    });
    const revokedRow = await db.invitation.findUniqueOrThrow({
      where: { id: revoked.id },
    });

    await organizer.seed();

    const rows = await invitationsBy(organizer.id);
    expect(rows).toHaveLength(4);
    expect(rows.find(({ id }) => id === revoked.id)).toEqual(revokedRow);
    for (const row of kept) {
      expect(rows.find(({ id }) => id === row.id)).toEqual(row);
    }
    const replacement = rows.filter(
      ({ note, id }) => note === revoked.note && id !== revoked.id,
    );
    expect(replacement).toHaveLength(1);
    expect(isOpen(replacement[0])).toBe(true);
  });

  test("never touches a used or expired row with a seed note", async () => {
    const organizer = await organizerCopy();
    const used = await scope.createInvitation({
      state: "used",
      note: organizer.notes[0],
      createdById: organizer.id,
    });
    const expired = await scope.createInvitation({
      state: "expired",
      note: organizer.notes[1],
      createdById: organizer.id,
    });
    const before = await db.invitation.findMany({
      where: { id: { in: [used.id, expired.id] } },
      orderBy: { id: "asc" },
    });

    await organizer.seed();

    expect(
      await db.invitation.findMany({
        where: { id: { in: [used.id, expired.id] } },
        orderBy: { id: "asc" },
      }),
    ).toEqual(before);
    const open = (await invitationsBy(organizer.id)).filter(isOpen);
    expect(open.map(({ note }) => note).sort()).toEqual(
      [...organizer.notes].sort(),
    );
  });

  test("refuses an organizer outside the seed domain and writes nothing", async () => {
    const outsider = await scope.createTestUser({ role: "organizer" });

    await expect(
      seedInvitations(db, { organizerEmail: outsider.email, notes: ["x"] }),
    ).rejects.toThrow(/organizer/);
    expect(await invitationsBy(outsider.id)).toEqual([]);
  });
});
