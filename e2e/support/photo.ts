import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

// A generated solid-colour JPEG, never a real photo (OQ-15).
export const fixturePhotoPath = () =>
  path.join(process.cwd(), "e2e", ".generated", "fixture.jpg");

export async function generateFixturePhoto(): Promise<void> {
  const file = fixturePhotoPath();
  await mkdir(path.dirname(file), { recursive: true });
  await sharp({
    create: {
      width: 1200,
      height: 900,
      channels: 3,
      background: { r: 96, g: 128, b: 112 },
    },
  })
    .jpeg({ quality: 80 })
    .toFile(file);
}
