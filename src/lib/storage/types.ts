export type PhotoStorage = {
  put(
    key: string,
    bytes: Uint8Array,
    contentType: "image/webp",
  ): Promise<{ url: string }>;
  // Resolves when the file is already gone, so retries are idempotent.
  delete(key: string): Promise<void>;
};
