import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDiskStorage, diskStorageRoot } from "./disk";
import { newPhotoKey } from "./keys";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "lendshed-disk-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const bytes = new Uint8Array([1, 2, 3, 4]);
const stored = async (key: string) =>
  new Uint8Array(await readFile(path.join(root, key)));

describe("createDiskStorage", () => {
  test("put writes under the root, creating folders, and returns the public URL", async () => {
    const storage = createDiskStorage({ root, urlPrefix: "/uploads/" });

    expect(await storage.put("items/a.webp", bytes, "image/webp")).toEqual({
      url: "/uploads/items/a.webp",
    });
    expect(await stored("items/a.webp")).toEqual(bytes);
  });

  test("put never overwrites an existing key", async () => {
    const storage = createDiskStorage({ root, urlPrefix: "/uploads/" });
    await storage.put("items/a.webp", bytes, "image/webp");

    await expect(
      storage.put("items/a.webp", new Uint8Array([9]), "image/webp"),
    ).rejects.toThrow();
    expect(await stored("items/a.webp")).toEqual(bytes);
  });

  test("delete removes the file, and a missing key resolves", async () => {
    const storage = createDiskStorage({ root, urlPrefix: "/uploads/" });
    await storage.put("items/a.webp", bytes, "image/webp");

    await storage.delete("items/a.webp");
    await expect(stat(path.join(root, "items", "a.webp"))).rejects.toThrow();
    await expect(storage.delete("items/a.webp")).resolves.toBeUndefined();
    await expect(storage.delete("items/never.webp")).resolves.toBeUndefined();
  });

  test("a key that escapes the root is refused", async () => {
    const storage = createDiskStorage({ root, urlPrefix: "/uploads/" });

    await expect(
      storage.put("../outside.webp", bytes, "image/webp"),
    ).rejects.toThrow("outside the disk root");
    await expect(storage.delete("../../etc/passwd")).rejects.toThrow(
      "outside the disk root",
    );
  });

  test("the app's root is public/uploads under the working directory", () => {
    expect(diskStorageRoot("/srv/app")).toBe(
      path.join("/srv/app", "public", "uploads"),
    );
  });
});

describe("newPhotoKey", () => {
  test("is items/{uuid}.webp and never repeats", () => {
    const keys = Array.from({ length: 50 }, newPhotoKey);
    for (const key of keys) {
      expect(key).toMatch(/^items\/[0-9a-f-]{36}\.webp$/);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });
});
