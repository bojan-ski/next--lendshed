import "server-only";
import { db } from "@/db";
import type { Prisma } from "@/generated/prisma/client";
import { getPhotoStorage } from "@/lib/storage/storage";

const LAST_ERROR_MAX = 300;

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
