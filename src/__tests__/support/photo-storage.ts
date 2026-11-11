import { stat } from "node:fs/promises";
import path from "node:path";
import {
  createDiskStorage,
  DISK_URL_PREFIX,
  diskStorageRoot,
} from "@/lib/storage/disk";
import type { PhotoStorage } from "@/lib/storage/types";

// The app's disk driver with switches to make it fail, and a record of every
// key it was asked to store (so a test can track keys the action generated).
// Use with:
//   vi.mock("@/lib/storage/storage", async () =>
//     (await import("@/__tests__/support/photo-storage")).photoStorageModule);
const disk = createDiskStorage({
  root: diskStorageRoot(),
  urlPrefix: DISK_URL_PREFIX,
});

export const storageControl = {
  failPut: false,
  // Thrown by every delete, or only for the keys in `failDeleteKeys` when set.
  failDelete: null as Error | null,
  failDeleteKeys: null as Set<string> | null,
  putKeys: [] as string[],
  reset() {
    this.failPut = false;
    this.failDelete = null;
    this.failDeleteKeys = null;
  },
};

const storage: PhotoStorage = {
  async put(key, bytes, contentType) {
    storageControl.putKeys.push(key);
    if (storageControl.failPut) throw new Error("storage put failed");
    return disk.put(key, bytes, contentType);
  },
  async delete(key) {
    const { failDelete, failDeleteKeys } = storageControl;
    if (failDelete && (!failDeleteKeys || failDeleteKeys.has(key))) {
      throw failDelete;
    }
    return disk.delete(key);
  },
};

export const photoStorageModule = { getPhotoStorage: () => storage };

export async function storedFileSize(key: string): Promise<number | null> {
  try {
    return (await stat(path.join(diskStorageRoot(), key))).size;
  } catch {
    return null;
  }
}
