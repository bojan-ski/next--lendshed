import {
  storageControl,
  storedFileSize,
} from "@/__tests__/support/photo-storage";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import {
  attachItemPhoto,
  getUploadCounts,
  isOwnUploadTarget,
  reservePhotoUpload,
} from "./photos";

vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

// While a snapshot is open, `db` (in this file, the scope and photos.ts) is
// that transaction's client.
const snapshot = vi.hoisted(() => ({ tx: null as object | null }));
vi.mock("@/db", async (importOriginal) => {
  const { db } = await importOriginal<typeof import("@/db")>();
  return {
    db: new Proxy(db, {
      get(target, key) {
        const source = (snapshot.tx ?? target) as Record<PropertyKey, unknown>;
        const value = source[key];
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterEach(() => storageControl.reset());
afterAll(() => scope.cleanup());

const owner = async () => (await scope.createTestUser()).id;
const queueRow = (storageKey: string) =>
  db.pendingBlobDeletion.findUnique({ where: { storageKey } });

// The month and storage sums are app-wide, and other files write those tables
// meanwhile. One REPEATABLE READ snapshot sees only this test's writes, so a
// before/after difference is exact; it is rolled back, leaving no rows.
const ROLLBACK = Symbol("rollback");
async function inOneSnapshot<T>(run: () => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await db.$transaction(
      async (tx) => {
        snapshot.tx = tx;
        try {
          result = await run();
        } finally {
          snapshot.tx = null;
        }
        throw ROLLBACK;
      },
      { isolationLevel: "RepeatableRead", maxWait: 15_000, timeout: 30_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result as T;
}

// A stored, reserved file, as the action leaves it just before attaching.
async function reservedPhoto(userId: string) {
  const photo = await scope.createStoredPhoto();
  await reservePhotoUpload(userId, photo.photoKey, photo.photoBytes);
  return {
    key: photo.photoKey,
    url: photo.photoUrl,
    width: photo.photoWidth,
    height: photo.photoHeight,
    bytes: photo.photoBytes,
  };
}

describe("isOwnUploadTarget", () => {
  test("true only for the owner's hidden or listed item", async () => {
    const ownerId = await owner();
    const other = await owner();
    const hidden = await scope.createItem({ ownerId });
    const listed = await scope.createItem({ ownerId, status: "listed" });
    const retired = await scope.createItem({ ownerId, status: "retired" });

    expect(await isOwnUploadTarget(ownerId, hidden.id)).toBe(true);
    expect(await isOwnUploadTarget(ownerId, listed.id)).toBe(true);
    expect(await isOwnUploadTarget(ownerId, retired.id)).toBe(false);
    expect(await isOwnUploadTarget(other, hidden.id)).toBe(false);
    expect(await isOwnUploadTarget(ownerId, crypto.randomUUID())).toBe(false);
    expect(await isOwnUploadTarget(ownerId, "not-an-id")).toBe(false);
  });
});

describe("getUploadCounts", () => {
  test("dayCount is exactly this user's rows since dayStart", async () => {
    const userId = await owner();
    const other = await owner();
    const dayStart = new Date(Date.now() - 60 * 60 * 1000);
    await db.uploadLog.createMany({
      data: [
        { userId, bytes: 10 },
        { userId, bytes: 10 },
        { userId, bytes: 10, createdAt: new Date(dayStart.getTime() - 1) },
        { userId: other, bytes: 10 },
      ],
    });

    const counts = await getUploadCounts(userId, {
      monthStart: new Date(0),
      dayStart,
    });

    expect(counts.dayCount).toBe(2);
  });

  test("N new rows raise monthCount by N; queued bytes count as stored", async () => {
    const userId = await owner();
    const since = {
      monthStart: new Date(Date.now() - 1000),
      dayStart: new Date(0),
    };
    const photo = await scope.createStoredPhoto();

    const [before, after] = await inOneSnapshot(async () => {
      const first = await getUploadCounts(userId, since);
      await db.uploadLog.createMany({
        data: Array.from({ length: 3 }, () => ({ userId, bytes: 5 })),
      });
      await db.pendingBlobDeletion.create({
        data: { storageKey: photo.photoKey, bytes: 7_000_000 },
      });
      return [first, await getUploadCounts(userId, since)];
    });

    expect(after.monthCount - before.monthCount).toBe(3);
    expect(after.storedBytes - before.storedBytes).toBe(7_000_000);
  });

  // The month cap is app-wide. A window starting in the future holds only the
  // rows this test dates into it, so the count is exact on a shared database.
  test("monthCount is every member's rows from monthStart on, exactly", async () => {
    const userId = await owner();
    const other = await owner();
    const monthStart = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
    const at = (offset: number) => new Date(monthStart.getTime() + offset);
    await db.uploadLog.createMany({
      data: [
        { userId, bytes: 10, createdAt: at(0) },
        { userId: other, bytes: 10, createdAt: at(1) },
        { userId: other, bytes: 10, createdAt: at(-1) },
      ],
    });

    const counts = await getUploadCounts(userId, {
      monthStart,
      dayStart: monthStart,
    });

    expect(counts.monthCount).toBe(2);
  });

  test("another member's item's photoBytes count as stored", async () => {
    const userId = await owner();
    const since = { monthStart: new Date(), dayStart: new Date() };
    const ownerId = await owner();
    // Made outside the snapshot: createItem would memoise a rolled-back one.
    const { id: categoryId } = await scope.createCategory("Snapshot");
    const photo = await scope.createStoredPhoto();

    const [before, after] = await inOneSnapshot(async () => {
      const first = await getUploadCounts(userId, since);
      await scope.createItem({
        ownerId,
        categoryId,
        photo: { ...photo, photoBytes: 9_000_000 },
      });
      return [first, await getUploadCounts(userId, since)];
    });

    expect(after.storedBytes - before.storedBytes).toBe(9_000_000);
  });
});

describe("reservePhotoUpload", () => {
  test("writes the upload log row and the reservation together", async () => {
    const userId = await owner();
    const photo = await scope.createStoredPhoto();

    await reservePhotoUpload(userId, photo.photoKey, 1234);

    expect(
      await db.uploadLog.findMany({
        where: { userId },
        select: { bytes: true },
      }),
    ).toEqual([{ bytes: 1234 }]);
    expect(await queueRow(photo.photoKey)).toMatchObject({ bytes: 1234 });
  });

  test("a reused key fails both writes: no log row without a reservation", async () => {
    const userId = await owner();
    const photo = await scope.createStoredPhoto();
    await reservePhotoUpload(userId, photo.photoKey, 1);

    await expect(
      reservePhotoUpload(userId, photo.photoKey, 2),
    ).rejects.toThrow();
    expect(await db.uploadLog.count({ where: { userId } })).toBe(1);
  });
});

describe("attachItemPhoto", () => {
  test("a first photo: five columns set, reservation gone, status and listedAt kept", async () => {
    const ownerId = await owner();
    const item = await scope.createItem({ ownerId, status: "listed" });
    const before = await db.item.findUniqueOrThrow({ where: { id: item.id } });
    const photo = await reservedPhoto(ownerId);

    expect(await attachItemPhoto(ownerId, item.id, photo)).toBe("saved");

    expect(
      await db.item.findUniqueOrThrow({ where: { id: item.id } }),
    ).toMatchObject({
      status: "listed",
      listedAt: before.listedAt,
      photoKey: photo.key,
      photoUrl: photo.url,
      photoWidth: photo.width,
      photoHeight: photo.height,
      photoBytes: photo.bytes,
    });
    expect(await queueRow(photo.key)).toBeNull();
    expect(await storedFileSize(photo.key)).toBe(photo.bytes);
  });

  test("a replacement queues the old file in the transaction and deletes it after commit", async () => {
    const ownerId = await owner();
    const old = await scope.createStoredPhoto();
    const item = await scope.createItem({ ownerId, photo: old });
    const photo = await reservedPhoto(ownerId);

    expect(await attachItemPhoto(ownerId, item.id, photo)).toBe("saved");

    expect(await storedFileSize(old.photoKey)).toBeNull();
    expect(await queueRow(old.photoKey)).toBeNull();
    expect(
      (await db.item.findUniqueOrThrow({ where: { id: item.id } })).photoKey,
    ).toBe(photo.key);
  });

  test("a failed old-file delete stays queued and the attach still succeeds", async () => {
    const ownerId = await owner();
    const old = await scope.createStoredPhoto();
    const item = await scope.createItem({ ownerId, photo: old });
    const photo = await reservedPhoto(ownerId);
    storageControl.failDelete = new Error("storage down");

    expect(await attachItemPhoto(ownerId, item.id, photo)).toBe("saved");

    expect(await queueRow(old.photoKey)).toMatchObject({
      bytes: old.photoBytes,
      attempts: 1,
      lastError: "Error: storage down",
    });
    expect(await storedFileSize(old.photoKey)).toBe(old.photoBytes);
  });

  test.each([
    ["retired", "retired" as const, true],
    ["someone else's", "hidden" as const, false],
  ])(
    "a %s item is stale: the new file is deleted, the old photo kept",
    async (_case, status, ownItem) => {
      const ownerId = await owner();
      const old = await scope.createStoredPhoto();
      const item = await scope.createItem({
        ownerId: ownItem ? ownerId : await owner(),
        status,
        photo: old,
      });
      const photo = await reservedPhoto(ownerId);

      expect(await attachItemPhoto(ownerId, item.id, photo)).toBe("stale");

      expect(await storedFileSize(photo.key)).toBeNull();
      expect(await queueRow(photo.key)).toBeNull();
      expect(
        (await db.item.findUniqueOrThrow({ where: { id: item.id } })).photoKey,
      ).toBe(old.photoKey);
      expect(await storedFileSize(old.photoKey)).toBe(old.photoBytes);
    },
  );

  test("an unknown item is stale and its reservation drained", async () => {
    const ownerId = await owner();
    const photo = await reservedPhoto(ownerId);

    expect(await attachItemPhoto(ownerId, crypto.randomUUID(), photo)).toBe(
      "stale",
    );
    expect(await queueRow(photo.key)).toBeNull();
  });
});
