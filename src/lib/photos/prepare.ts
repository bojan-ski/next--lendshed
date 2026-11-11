import {
  CLIENT_PHOTO_MAX_BYTES,
  CLIENT_PHOTO_MAX_EDGE,
} from "@/lib/photos/limits";

// Browser-only (canvas). Always re-encodes, which also drops the source's
// metadata before anything leaves the device.
const QUALITIES = [0.85, 0.75, 0.65, 0.55];
const EDGE_STEP = 0.75;
const EDGE_RETRIES = 3;

export type PreparedPhoto = { kind: "ready"; blob: Blob } | { kind: "failed" };

function toJpeg(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("No blob"))),
      "image/jpeg",
      quality,
    );
  });
}

async function encodeAtEdge(
  bitmap: ImageBitmap,
  edge: number,
): Promise<Blob | null> {
  const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No 2D canvas");
  // JPEG has no transparency: paint it white rather than black.
  context.fillStyle = "white";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  for (const quality of QUALITIES) {
    const blob = await toJpeg(canvas, quality);
    if (blob.size <= CLIENT_PHOTO_MAX_BYTES) return blob;
  }
  return null;
}

export async function preparePhotoForUpload(file: File): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { kind: "failed" };
  }
  try {
    let edge = Math.min(
      CLIENT_PHOTO_MAX_EDGE,
      Math.max(bitmap.width, bitmap.height),
    );
    for (let attempt = 0; attempt <= EDGE_RETRIES; attempt++) {
      const blob = await encodeAtEdge(bitmap, edge);
      if (blob) return { kind: "ready", blob };
      edge = Math.round(edge * EDGE_STEP);
    }
    return { kind: "failed" };
  } catch {
    return { kind: "failed" };
  } finally {
    bitmap.close();
  }
}
