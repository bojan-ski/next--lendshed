import {
  storageControl,
  storedFileSize,
} from "@/__tests__/support/photo-storage";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { TEST_ZONES, useProcessTimeZone } from "@/__tests__/support/time-zone";
import { db } from "@/db";
import {
  communityMidnight,
  communityToday,
  firstOfMonth,
  formatMonth,
} from "@/lib/dates/dates";
import { LISTED_ITEMS_WARN_AT, UPLOAD_LIMITS } from "@/lib/photos/caps";
import {
  attachItemPhoto,
  getUploadCounts,
  getUsage,
  isOwnUploadTarget,
  reservePhotoUpload,
} from "./photos";

vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

vi.mock("@/db", async (importOriginal) =>
  (await import("@/__tests__/support/snapshot")).snapshotDbModule(
    await importOriginal<typeof import("@/db")>(),
  ),
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterEach(() => storageControl.reset());
afterAll(() => scope.cleanup());

const owner = async () => (await scope.createTestUser()).id;
const queueRow = (storageKey: string) =>
  db.pendingBlobDeletion.findUnique({ where: { storageKey } });

// The month and storage sums are app-wide, and other files write those tables
// meanwhile: their before/after reads run in one rolled-back snapshot.

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

describe("getUsage", () => {
  const today = communityToday();

  test("uploads, photoBytes and queued bytes add exactly; empty sums are numbers", async () => {
    const userId = await owner();
    const ownerId = await owner();
    const { id: categoryId } = await scope.createCategory("Usage");
    const [stored, queued] = [
      await scope.createStoredPhoto(),
      await scope.createStoredPhoto(),
    ];

    const [before, after] = await inOneSnapshot(async () => {
      const first = await getUsage(today);
      await db.uploadLog.createMany({
        data: Array.from({ length: 4 }, () => ({ userId, bytes: 5 })),
      });
      await scope.createItem({
        ownerId,
        categoryId,
        photo: { ...stored, photoBytes: 3_000_000 },
      });
      await db.pendingBlobDeletion.create({
        data: { storageKey: queued.photoKey, bytes: 2_000_000 },
      });
      return [first, await getUsage(today)];
    });

    expect(after.uploads.used - before.uploads.used).toBe(4);
    expect(after.storedBytes.used - before.storedBytes.used).toBe(5_000_000);
    expect(typeof before.storedBytes.used).toBe("number");
    expect(Number.isNaN(before.storedBytes.used)).toBe(false);
  });

  test("listed counts stored listed items of any owner; hidden and retired add 0", async () => {
    const active = await owner();
    const suspended = (await scope.createTestUser({ status: "suspended" })).id;
    const { id: categoryId } = await scope.createCategory("Listed");

    const [before, after] = await inOneSnapshot(async () => {
      const first = await getUsage(today);
      await scope.createItem({ ownerId: active, categoryId, status: "listed" });
      await scope.createItem({
        ownerId: suspended,
        categoryId,
        status: "listed",
      });
      await scope.createItem({ ownerId: active, categoryId, status: "hidden" });
      await scope.createItem({
        ownerId: active,
        categoryId,
        status: "retired",
      });
      return [first, await getUsage(today)];
    });

    expect(after.listedItems.used - before.listedItems.used).toBe(2);
  });

  test("matches getUploadCounts' monthCount and storedBytes in one snapshot", async () => {
    const userId = await owner();
    const monthStart = communityMidnight(firstOfMonth(today));

    const [usage, counts] = await inOneSnapshot(async () => [
      await getUsage(today),
      await getUploadCounts(userId, { monthStart, dayStart: monthStart }),
    ]);

    expect(usage.uploads.used).toBe(counts.monthCount);
    expect(usage.storedBytes.used).toBe(counts.storedBytes);
  });

  test("the DTO carries only the contract's fields and the caps' numbers", async () => {
    const usage = await inOneSnapshot(() => getUsage(today));

    expect(Object.keys(usage).sort()).toEqual(
      ["listedItems", "monthLabel", "storedBytes", "uploads"].sort(),
    );
    expect(Object.keys(usage.uploads).sort()).toEqual(
      ["cap", "percent", "used", "warn"].sort(),
    );
    expect(usage.uploads.cap).toBe(UPLOAD_LIMITS.monthly);
    expect(usage.storedBytes.cap).toBe(UPLOAD_LIMITS.storedBytes);
    expect(Object.keys(usage.listedItems).sort()).toEqual(
      ["percent", "used", "warn", "warnAt"].sort(),
    );
    expect(usage.listedItems.warnAt).toBe(LISTED_ITEMS_WARN_AT);
  });

  // A far-future month holds only this test's rows; the boundary is the
  // community midnight whatever zone the process runs in.
  describe.each(TEST_ZONES)("month window in process zone %s", (zone) => {
    useProcessTimeZone(zone);

    test("the first-of-month community midnight is in; 1 ms before is out", async () => {
      const userId = await owner();
      const futureToday = "2101-03-15";
      const start = communityMidnight(firstOfMonth(futureToday));

      const [before, after] = await inOneSnapshot(async () => {
        const first = await getUsage(futureToday);
        await db.uploadLog.createMany({
          data: [
            { userId, bytes: 1, createdAt: start },
            { userId, bytes: 1, createdAt: new Date(start.getTime() - 1) },
          ],
        });
        return [first, await getUsage(futureToday)];
      });

      expect(after.uploads.used - before.uploads.used).toBe(1);
      expect(after.monthLabel).toBe(formatMonth(futureToday));
    });
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
