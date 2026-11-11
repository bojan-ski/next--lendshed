import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import { createDiskStorage } from "@/lib/storage/disk";
import { SEED_ITEMS, type SeedItem } from "./items";
import { SEED_PEOPLE } from "./people";
import { ensureItemPhotos } from "./photos";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// Converges on scope users and items only, into a temporary disk root; the
// real cast and public/uploads are untouched.
const scope = createTestScope();
let root: string;

beforeAll(async () => {
  await assertMigrated();
  root = await mkdtemp(path.join(tmpdir(), "lendshed-seed-photos-"));
});
afterAll(async () => {
  await scope.cleanup();
  await rm(root, { recursive: true, force: true });
});

const entry = (ownerEmail: string, title: string): SeedItem => ({
  ownerEmail,
  category: "unused here",
  title,
  condition: "good",
  maxLoanDays: 7,
});

const row = (id: string) =>
  db.item.findUniqueOrThrow({
    where: { id },
    select: {
      status: true,
      listedAt: true,
      photoKey: true,
      photoUrl: true,
      photoWidth: true,
      photoHeight: true,
      photoBytes: true,
    },
  });

describe("ensureItemPhotos", () => {
  test("gives each photo-less item a flat placeholder, lists owners with contact details, and converges", async () => {
    const storage = createDiskStorage({ root, urlPrefix: "/uploads/" });
    const ana = await scope.createTestUser({ contactDetails: "Phone 1" });
    const tom = await scope.createTestUser();
    const drill = await scope.createItem({ ownerId: ana.id, title: "Drill" });
    const rake = await scope.createItem({ ownerId: ana.id, title: "Rake" });
    const ladder = await scope.createItem({ ownerId: tom.id, title: "Ladder" });
    const existing = await scope.createStoredPhoto();
    const kept = await scope.createItem({
      ownerId: ana.id,
      title: "Saw",
      photo: existing,
    });
    const entries = [
      entry(ana.email, "Drill"),
      entry(ana.email, "Rake"),
      entry(tom.email, "Ladder"),
      entry(ana.email, "Saw"),
      entry(tom.email, "Not created"),
    ];

    expect(await ensureItemPhotos(db, storage, entries)).toEqual({
      photographed: 3,
      listed: 2,
    });

    for (const { id } of [drill, rake]) {
      const listed = await row(id);
      expect(listed).toMatchObject({
        status: "listed",
        photoWidth: 1200,
        photoHeight: 1200,
      });
      expect(listed.listedAt).toBeInstanceOf(Date);
      expect(listed.photoUrl).toBe(`/uploads/${listed.photoKey}`);
      // Read first: sharp holds a path's file open on Windows (EBUSY on rm).
      const file = await readFile(path.join(root, listed.photoKey!));
      const meta = await sharp(file).metadata();
      expect([meta.format, meta.width, meta.height]).toEqual([
        "webp",
        1200,
        1200,
      ]);
      expect(file.byteLength).toBe(listed.photoBytes);
    }
    expect(await row(ladder.id)).toMatchObject({
      status: "hidden",
      listedAt: null,
      photoWidth: 1200,
    });
    expect(await row(kept.id)).toMatchObject({
      status: "hidden",
      photoKey: existing.photoKey,
    });

    // A manual hide after seeding survives a re-run, which changes nothing.
    await db.item.update({
      where: { id: drill.id },
      data: { status: "hidden", listedAt: null },
    });
    const before = await Promise.all(
      [drill, rake, ladder, kept].map(({ id }) => row(id)),
    );
    expect(await ensureItemPhotos(db, storage, entries)).toEqual({
      photographed: 0,
      listed: 0,
    });
    expect(
      await Promise.all([drill, rake, ladder, kept].map(({ id }) => row(id))),
    ).toEqual(before);
  });

  test("a retired item is left alone", async () => {
    const storage = createDiskStorage({ root, urlPrefix: "/uploads/" });
    const ana = await scope.createTestUser({ contactDetails: "Phone 2" });
    const { id } = await scope.createItem({
      ownerId: ana.id,
      title: "Old tent",
      status: "retired",
    });

    expect(
      await ensureItemPhotos(db, storage, [entry(ana.email, "Old tent")]),
    ).toEqual({ photographed: 0, listed: 0 });
    expect((await row(id)).photoKey).toBeNull();
  });
});

describe("seedPhotos's cast", () => {
  test("the suspended member has contact details and a seed item, so it gets listed", () => {
    const suspended = SEED_PEOPLE.filter(
      ({ status }) => status === "suspended",
    );
    expect(suspended).toHaveLength(1);
    expect(suspended[0].contactDetails).not.toBeNull();
    expect(
      SEED_ITEMS.some(({ ownerEmail }) => ownerEmail === suspended[0].email),
    ).toBe(true);
  });

  test("the member without contact details owns a seed item, which stays Hidden", () => {
    const withoutContact = SEED_PEOPLE.filter(
      ({ status, contactDetails }) =>
        status === "active" && contactDetails === null,
    );
    expect(withoutContact).toHaveLength(1);
    expect(
      SEED_ITEMS.some(
        ({ ownerEmail }) => ownerEmail === withoutContact[0].email,
      ),
    ).toBe(true);
  });
});
