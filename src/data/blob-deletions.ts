import "server-only";
import { db } from "@/db";
import type { Prisma } from "@/generated/prisma/client";
import { getPhotoStorage } from "@/lib/storage/storage";

const LAST_ERROR_MAX = 300;
// Younger rows may be in-flight upload reservations.
export const BLOB_RETRY_MIN_AGE_MS = 60 * 60 * 1000;
export const BLOB_RETRY_BATCH = 200;

// The outbox: called inside the transaction that stops referencing the file,
// so a crash after commit leaves a queued row, never an unknown file.
export async function queueBlobDeletion(
  tx: Prisma.TransactionClient,
  entry: { storageKey: string; bytes: number },
): Promise<void> {
  await tx.pendingBlobDeletion.create({ data: entry });
}

function describe(error: unknown): string {
  const text =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.slice(0, LAST_ERROR_MAX);
}

// After commit. A failed delete stays queued for the daily job (spec 22) and
// never turns a committed action into a failure.
export async function deletePendingBlobs(keys: string[]): Promise<void> {
  for (const storageKey of keys) {
    try {
      await getPhotoStorage().delete(storageKey);
      await db.pendingBlobDeletion.deleteMany({ where: { storageKey } });
    } catch (error) {
      await db.pendingBlobDeletion
        .updateMany({
          where: { storageKey },
          data: { attempts: { increment: 1 }, lastError: describe(error) },
        })
        .catch(() => undefined);
    }
  }
}

// The daily job's retry. An hour-old row names a file nothing references, so
// deleting it is always right; failures stay queued with no give-up limit.
export async function retryPendingBlobDeletions(
  now: Date,
  limit = BLOB_RETRY_BATCH,
): Promise<number> {
  const rows = await db.pendingBlobDeletion.findMany({
    where: {
      createdAt: { lt: new Date(now.getTime() - BLOB_RETRY_MIN_AGE_MS) },
    },
    orderBy: [{ createdAt: "asc" }, { storageKey: "asc" }],
    take: limit,
    select: { storageKey: true },
  });
  const keys = rows.map((row) => row.storageKey);
  await deletePendingBlobs(keys);
  return keys.length;
}
