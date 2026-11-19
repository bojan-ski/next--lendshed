import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import { createDiskStorage, DISK_URL_PREFIX } from "@/lib/storage/disk";
import { SEED_ITEMS, type SeedItem } from "./items";
import { SEED_PEOPLE } from "./people";
import { ensureItemPhotos, seedPhotoStorage } from "./photos";

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

  test("a photo under replacePrefix moves to the new store, the item keeps its status, and a re-run converges", async () => {
    const storage = createDiskStorage({
      root,
      urlPrefix: "https://store.example.test/",
    });
    const ana = await scope.createTestUser({ contactDetails: "Phone 3" });
    const listed = await scope.createItem({
      ownerId: ana.id,
      title: "Wheelbarrow",
      status: "listed",
      photo: await scope.createStoredPhoto(),
    });
    const hidden = await scope.createItem({
      ownerId: ana.id,
      title: "Hedge trimmer",
      photo: await scope.createStoredPhoto(),
    });
    const elsewhere = await scope.createItem({
      ownerId: ana.id,
      title: "Tile cutter",
      photo: true,
    });
    const entries = [
      entry(ana.email, "Wheelbarrow"),
      entry(ana.email, "Hedge trimmer"),
      entry(ana.email, "Tile cutter"),
    ];
    const untouched = await row(elsewhere.id);

    expect(
      await ensureItemPhotos(db, storage, entries, DISK_URL_PREFIX),
    ).toEqual({ photographed: 2, listed: 0 });

    for (const [{ id }, status] of [
      [listed, "listed"],
      [hidden, "hidden"],
    ] as const) {
      const moved = await row(id);
      expect(moved.status).toBe(status);
      expect(moved.photoUrl).toBe(
        `https://store.example.test/${moved.photoKey}`,
      );
      expect(moved.photoWidth).toBe(1200);
    }
    expect(await row(elsewhere.id)).toEqual(untouched);

    expect(
      await ensureItemPhotos(db, storage, entries, DISK_URL_PREFIX),
    ).toEqual({ photographed: 0, listed: 0 });
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

describe("seedPhotoStorage", () => {
  const blob = {
    STORAGE_DRIVER: "blob",
    BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_test_token",
    BLOB_PUBLIC_HOST: "abc123.public.blob.vercel-storage.com",
  };

  test.each([undefined, "", "disk"])(
    "STORAGE_DRIVER=%s seeds to disk and replaces nothing",
    (driver) => {
      expect(
        seedPhotoStorage({ STORAGE_DRIVER: driver }).replacePrefix,
      ).toBeUndefined();
    },
  );

  test("blob seeds to the store and moves disk-stored photos", () => {
    expect(seedPhotoStorage(blob).replacePrefix).toBe(DISK_URL_PREFIX);
  });

  test.each(["BLOB_READ_WRITE_TOKEN", "BLOB_PUBLIC_HOST"] as const)(
    "blob without %s is refused",
    (name) => {
      expect(() => seedPhotoStorage({ ...blob, [name]: "" })).toThrow(
        "Blob seeding needs BLOB_READ_WRITE_TOKEN and BLOB_PUBLIC_HOST",
      );
    },
  );
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
