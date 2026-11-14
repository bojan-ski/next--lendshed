import "server-only";
import { db } from "@/db";
import { deletePendingBlobs, queueBlobDeletion } from "@/data/blob-deletions";
import { isEditable, lockOwnItem } from "@/data/items";
import { toUsageDTO } from "@/data/mappers";
import { communityMidnight, firstOfMonth } from "@/lib/dates/dates";
import type { StoredPhoto, UploadCounts } from "@/types/photo";
import type { UsageDTO } from "@/types/usage";

// The action's pre-check; `attachItemPhoto` re-checks under the item lock.
export async function isOwnUploadTarget(
  ownerId: string,
  itemId: string,
): Promise<boolean> {
  const count = await db.item.count({
    where: { id: itemId, ownerId, status: { in: ["hidden", "listed"] } },
  });
  return count > 0;
}

// The upload guard and the usage panel share these two, so they never disagree.
function countUploadsSince(since: Date): Promise<number> {
  return db.uploadLog.count({ where: { createdAt: { gte: since } } });
}

// Reserved and queued files count until they are gone.
async function sumStoredBytes(): Promise<number> {
  const [items, pending] = await Promise.all([
    db.item.aggregate({ _sum: { photoBytes: true } }),
    db.pendingBlobDeletion.aggregate({ _sum: { bytes: true } }),
  ]);
  return (items._sum.photoBytes ?? 0) + (pending._sum.bytes ?? 0);
}

// Uncached.
export async function getUploadCounts(
  userId: string,
  since: { monthStart: Date; dayStart: Date },
): Promise<UploadCounts> {
  const [monthCount, dayCount, storedBytes] = await Promise.all([
    countUploadsSince(since.monthStart),
    db.uploadLog.count({
      where: { userId, createdAt: { gte: since.dayStart } },
    }),
    sumStoredBytes(),
  ]);
  return { monthCount, dayCount, storedBytes };
}

// Uncached; the month window is the upload action's. Listed counts every owner.
export async function getUsage(today: string): Promise<UsageDTO> {
  const [monthCount, storedBytes, listedCount] = await Promise.all([
    countUploadsSince(communityMidnight(firstOfMonth(today))),
    sumStoredBytes(),
    db.item.count({ where: { status: "listed" } }),
  ]);
  return toUsageDTO({ monthCount, storedBytes, listedCount }, today);
}

// Before storing: the log row counts the upload, and the reservation means a
// crash between storing and attaching leaves a queued deletion, not an orphan.
// The UploadLog insert key-share locks only the actor's own user row
// (rules/data.md exemption), so no organizer lock.
export async function reservePhotoUpload(
  userId: string,
  key: string,
  bytes: number,
): Promise<void> {
  await db.$transaction([
    db.uploadLog.create({ data: { userId, bytes } }),
    db.pendingBlobDeletion.create({ data: { storageKey: key, bytes } }),
  ]);
}

// Locks only the item row, so it can't cross spec 10's user-then-item order.
// Status and listedAt never change: a listed item stays listed.
export async function attachItemPhoto(
  ownerId: string,
  itemId: string,
  photo: StoredPhoto,
): Promise<"saved" | "stale"> {
  const outcome = await db.$transaction(async (tx) => {
    const item = await lockOwnItem(tx, ownerId, itemId);
    if (!isEditable(item)) return { result: "stale" as const };
    await tx.pendingBlobDeletion.deleteMany({
      where: { storageKey: photo.key },
    });
    if (item.photoKey !== null) {
      await queueBlobDeletion(tx, {
        storageKey: item.photoKey,
        bytes: item.photoBytes ?? 0,
      });
    }
    await tx.item.update({
      where: { id: itemId },
      data: {
        photoKey: photo.key,
        photoUrl: photo.url,
        photoWidth: photo.width,
        photoHeight: photo.height,
        photoBytes: photo.bytes,
      },
    });
    return { result: "saved" as const, oldKey: item.photoKey };
  });
  if (outcome.result === "stale") {
    await deletePendingBlobs([photo.key]);
    return "stale";
  }
  if (outcome.oldKey !== null) await deletePendingBlobs([outcome.oldKey]);
  return "saved";
}
