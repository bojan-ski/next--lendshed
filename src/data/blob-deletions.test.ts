import {
  storageControl,
  storedFileSize,
} from "@/__tests__/support/photo-storage";
import { inOneSnapshot } from "@/__tests__/support/snapshot";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import {
  BLOB_RETRY_MIN_AGE_MS,
  deletePendingBlobs,
  queueBlobDeletion,
  retryPendingBlobDeletions,
} from "./blob-deletions";

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

const queueRow = (storageKey: string) =>
  db.pendingBlobDeletion.findUnique({ where: { storageKey } });

async function queued() {
  const photo = await scope.createStoredPhoto();
  await db.$transaction((tx) =>
    queueBlobDeletion(tx, {
      storageKey: photo.photoKey,
      bytes: photo.photoBytes,
    }),
  );
  return photo;
}

describe("queueBlobDeletion", () => {
  test("writes inside the caller's transaction and rolls back with it", async () => {
    const photo = await scope.createStoredPhoto();

    await expect(
      db.$transaction(async (tx) => {
        await queueBlobDeletion(tx, {
          storageKey: photo.photoKey,
          bytes: photo.photoBytes,
        });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await queueRow(photo.photoKey)).toBeNull();

    await db.$transaction((tx) =>
      queueBlobDeletion(tx, {
        storageKey: photo.photoKey,
        bytes: photo.photoBytes,
      }),
    );
    expect(await queueRow(photo.photoKey)).toMatchObject({
      bytes: photo.photoBytes,
      attempts: 0,
      lastError: null,
    });
  });
});

describe("deletePendingBlobs", () => {
  test("deletes each file, then its queue row", async () => {
    const first = await queued();
    const second = await queued();

    await deletePendingBlobs([first.photoKey, second.photoKey]);

    for (const { photoKey } of [first, second]) {
      expect(await storedFileSize(photoKey)).toBeNull();
      expect(await queueRow(photoKey)).toBeNull();
    }
  });

  test("a failed delete stays queued with attempts and lastError, and never throws", async () => {
    const photo = await queued();
    storageControl.failDelete = new TypeError("storage down");

    await expect(deletePendingBlobs([photo.photoKey])).resolves.toBeUndefined();
    await deletePendingBlobs([photo.photoKey]);

    expect(await queueRow(photo.photoKey)).toMatchObject({
      attempts: 2,
      lastError: "TypeError: storage down",
    });
    expect(await storedFileSize(photo.photoKey)).toBe(photo.photoBytes);

    storageControl.reset();
    await deletePendingBlobs([photo.photoKey]);
    expect(await queueRow(photo.photoKey)).toBeNull();
    expect(await storedFileSize(photo.photoKey)).toBeNull();
  });

  test("lastError is cut to 300 characters", async () => {
    const photo = await queued();
    storageControl.failDelete = new Error("x".repeat(1000));

    await deletePendingBlobs([photo.photoKey]);

    const row = await queueRow(photo.photoKey);
    expect(row?.lastError).toHaveLength(300);
    expect(row?.lastError?.startsWith("Error: xxx")).toBe(true);
  });

  test("one failing key doesn't stop the next", async () => {
    const first = await queued();
    const second = await queued();
    storageControl.failDelete = new Error("first only");
    storageControl.failDeleteKeys = new Set([first.photoKey]);

    await deletePendingBlobs([first.photoKey, second.photoKey]);

    expect((await queueRow(first.photoKey))?.attempts).toBe(1);
    expect(await queueRow(second.photoKey)).toBeNull();
    expect(await storedFileSize(second.photoKey)).toBeNull();
  });

  test("a key with no queue row still has its file deleted", async () => {
    const photo = await scope.createStoredPhoto();

    await deletePendingBlobs([photo.photoKey]);

    expect(await storedFileSize(photo.photoKey)).toBeNull();
  });
});

// The daily job's retry reads the queue app-wide, so it runs in one rolled-back
// snapshot with a 2001 clock: only this test's rows (dated inside it) are old
// enough to be picked.
describe("retryPendingBlobDeletions", () => {
  const NOW = new Date("2001-03-10T12:00:00.000Z");
  const MINUTE = 60 * 1000;
  const agedBy = (ms: number) => new Date(NOW.getTime() - ms);

  async function queuedAt(createdAt: Date) {
    const photo = await scope.createStoredPhoto();
    await db.pendingBlobDeletion.create({
      data: {
        storageKey: photo.photoKey,
        bytes: photo.photoBytes,
        createdAt,
      },
    });
    return photo;
  }

  test("an hour-old row loses its file and its row; a 59-minute-old one is untouched", async () => {
    const result = await inOneSnapshot(async () => {
      const old = await queuedAt(agedBy(BLOB_RETRY_MIN_AGE_MS + MINUTE));
      const young = await queuedAt(agedBy(59 * MINUTE));
      const attempted = await retryPendingBlobDeletions(NOW);
      return {
        attempted,
        oldRow: await queueRow(old.photoKey),
        oldFile: await storedFileSize(old.photoKey),
        youngRow: await queueRow(young.photoKey),
        youngFile: await storedFileSize(young.photoKey),
        youngBytes: young.photoBytes,
      };
    });
    expect(result.attempted).toBe(1);
    expect(result.oldRow).toBeNull();
    expect(result.oldFile).toBeNull();
    expect(result.youngRow).toMatchObject({ attempts: 0, lastError: null });
    expect(result.youngFile).toBe(result.youngBytes);
  });

  test("a failing key stays queued with attempts + 1 and a lastError", async () => {
    const row = await inOneSnapshot(async () => {
      const photo = await queuedAt(agedBy(2 * BLOB_RETRY_MIN_AGE_MS));
      storageControl.failDelete = new Error("storage down");
      storageControl.failDeleteKeys = new Set([photo.photoKey]);
      expect(await retryPendingBlobDeletions(NOW)).toBe(1);
      return queueRow(photo.photoKey);
    });
    expect(row).toMatchObject({
      attempts: 1,
      lastError: "Error: storage down",
    });
  });

  test("past the limit, exactly `limit` keys are attempted, oldest first", async () => {
    const result = await inOneSnapshot(async () => {
      const oldest = await queuedAt(agedBy(5 * BLOB_RETRY_MIN_AGE_MS));
      const middle = await queuedAt(agedBy(4 * BLOB_RETRY_MIN_AGE_MS));
      const newest = await queuedAt(agedBy(3 * BLOB_RETRY_MIN_AGE_MS));
      const attempted = await retryPendingBlobDeletions(NOW, 2);
      return {
        attempted,
        gone: [
          await queueRow(oldest.photoKey),
          await queueRow(middle.photoKey),
        ],
        kept: await queueRow(newest.photoKey),
      };
    });
    expect(result.attempted).toBe(2);
    expect(result.gone).toEqual([null, null]);
    expect(result.kept).toMatchObject({ attempts: 0 });
  });
});
