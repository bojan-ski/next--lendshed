import "server-only";
import sharp from "sharp";
import { STORED_PHOTO_MAX_EDGE } from "@/lib/photos/limits";

const DECODED_FORMATS = new Set(["jpeg", "png", "webp"]);
const MAX_INPUT_PIXELS = 4_000_000;

export type EncodedPhoto =
  | { kind: "encoded"; bytes: Uint8Array; width: number; height: number }
  | { kind: "unreadable" };

// The content check: the browser's type and extension prove nothing. Any sharp
// failure is unreadable; its message is never parsed.
export async function encodeItemPhoto(input: Uint8Array): Promise<EncodedPhoto> {
  try {
    const image = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS });
    const { format } = await image.metadata();
    if (!format || !DECODED_FORMATS.has(format)) return { kind: "unreadable" };
    const { data, info } = await image
      .autoOrient()
      .resize({
        width: STORED_PHOTO_MAX_EDGE,
        height: STORED_PHOTO_MAX_EDGE,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return {
      kind: "encoded",
      bytes: new Uint8Array(data),
      width: info.width,
      height: info.height,
    };
  } catch {
    return { kind: "unreadable" };
  }
}
