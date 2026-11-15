import sharp from "sharp";
import type { PrismaClient } from "@/generated/prisma/client";
import { STORED_PHOTO_MAX_EDGE } from "@/lib/photos/limits";
import {
  createDiskStorage,
  DISK_URL_PREFIX,
  diskStorageRoot,
} from "@/lib/storage/disk";
import { newPhotoKey } from "@/lib/storage/keys";
import type { PhotoStorage } from "@/lib/storage/types";
import { SEED_ITEMS, type SeedItem } from "./items";

// Plain flat colours are the demo photos (OQ-15, decided): never a real,
// stock or board image.
const MUTED_COLOURS = [
  { r: 196, g: 183, b: 160 },
  { r: 160, g: 178, b: 168 },
  { r: 171, g: 168, b: 190 },
  { r: 199, g: 170, b: 158 },
  { r: 168, g: 186, b: 199 },
];

function placeholderPhoto(index: number): Promise<Buffer> {
  return sharp({
    create: {
      width: STORED_PHOTO_MAX_EDGE,
      height: STORED_PHOTO_MAX_EDGE,
      channels: 3,
      background: MUTED_COLOURS[index % MUTED_COLOURS.length],
    },
  })
    .webp({ quality: 80 })
    .toBuffer();
}

// Gives every photo-less seed item a placeholder and lists it when its owner
// has contact details (the suspended member's too, for spec 12a's scope
// sweep). An item that already has a photo is left alone, so a manual hide
// survives re-runs. No UploadLog rows: these aren't member uploads.
export async function ensureItemPhotos(
  client: PrismaClient,
  storage: PhotoStorage,
  entries: readonly SeedItem[],
): Promise<{ photographed: number; listed: number }> {
  let photographed = 0;
  let listed = 0;
  for (const [index, entry] of entries.entries()) {
    const item = await client.item.findFirst({
      where: { owner: { email: entry.ownerEmail }, title: entry.title },
      select: {
        id: true,
        status: true,
        photoKey: true,
        owner: { select: { contactDetails: true } },
      },
    });
    if (!item || item.photoKey !== null || item.status === "retired") continue;

    const bytes = await placeholderPhoto(index);
    const key = newPhotoKey();
    const { url } = await storage.put(key, bytes, "image/webp");
    const list =
      item.status === "hidden" && Boolean(item.owner?.contactDetails);
    await client.item.update({
      where: { id: item.id },
      data: {
        photoKey: key,
        photoUrl: url,
        photoWidth: STORED_PHOTO_MAX_EDGE,
        photoHeight: STORED_PHOTO_MAX_EDGE,
        photoBytes: bytes.byteLength,
        ...(list && { status: "listed", listedAt: new Date() }),
      },
    });
    photographed += 1;
    if (list) listed += 1;
  }
  return { photographed, listed };
}

export async function seedPhotos(
  client: PrismaClient,
): Promise<{ photographed: number; listed: number }> {
  const storage = createDiskStorage({
    root: diskStorageRoot(),
    urlPrefix: DISK_URL_PREFIX,
  });
  return ensureItemPhotos(client, storage, SEED_ITEMS);
}
