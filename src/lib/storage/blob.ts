import { BlobNotFoundError, del, put } from "@vercel/blob";
import type { PhotoStorage } from "@/lib/storage/types";

// Public store, generated keys (OQ-04): the key is the pathname as given.
export function createBlobStorage({
  token,
  publicHost,
}: {
  token: string;
  publicHost: string;
}): PhotoStorage {
  return {
    async put(key, bytes, contentType) {
      const blob = await put(key, Buffer.from(bytes), {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType,
        token,
      });
      // next/image only allows this host: a URL elsewhere would never render.
      if (new URL(blob.url).host !== publicHost) {
        throw new Error("Blob URL is not on the configured public host");
      }
      return { url: blob.url };
    },
    async delete(key) {
      try {
        await del(key, { token });
      } catch (error) {
        if (!(error instanceof BlobNotFoundError)) throw error;
      }
    },
  };
}
