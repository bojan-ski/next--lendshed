import {
  storageControl,
  storedFileSize,
} from "@/__tests__/support/photo-storage";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import { deletePendingBlobs, queueBlobDeletion } from "./blob-deletions";

vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
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
