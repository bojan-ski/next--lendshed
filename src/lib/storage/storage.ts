import "server-only";
import { env } from "@/lib/env/server";
import { createBlobStorage } from "@/lib/storage/blob";
import {
  createDiskStorage,
  DISK_URL_PREFIX,
  diskStorageRoot,
} from "@/lib/storage/disk";
import type { PhotoStorage } from "@/lib/storage/types";

let storage: PhotoStorage | undefined;

function createPhotoStorage(): PhotoStorage {
  if (env.STORAGE_DRIVER === "disk") {
    return createDiskStorage({ root: diskStorageRoot(), urlPrefix: DISK_URL_PREFIX });
  }
  // The env schema requires both with blob; this narrows the types.
  const { BLOB_READ_WRITE_TOKEN: token, BLOB_PUBLIC_HOST: publicHost } = env;
  if (!token || !publicHost) throw new Error("Blob storage is not configured");
  return createBlobStorage({ token, publicHost });
}

// Actions and data functions reach storage only through this.
export function getPhotoStorage(): PhotoStorage {
  storage ??= createPhotoStorage();
  return storage;
}
