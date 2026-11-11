import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhotoStorage } from "@/lib/storage/types";

// Dev/test only (the env refuses it on Vercel). `next dev` serves files added
// to public/ at any time; `next start` only those present when it started.
export const DISK_URL_PREFIX = "/uploads/";

export function diskStorageRoot(cwd: string = process.cwd()): string {
  return path.join(cwd, "public", "uploads");
}

export function createDiskStorage({
  root,
  urlPrefix,
}: {
  root: string;
  urlPrefix: string;
}): PhotoStorage {
  // Keys come from rows too: never let one step outside the root.
  const fileFor = (key: string) => {
    const file = path.resolve(root, key);
    if (!file.startsWith(path.resolve(root) + path.sep)) {
      throw new Error("Storage key outside the disk root");
    }
    return file;
  };

  return {
    async put(key, bytes) {
      const file = fileFor(key);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, bytes, { flag: "wx" });
      return { url: `${urlPrefix}${key}` };
    },
    async delete(key) {
      try {
        await unlink(fileFor(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
}
