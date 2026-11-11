import sharp from "sharp";
import { encodeItemPhoto } from "./encode";

const solid = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 90, g: 140, b: 110 },
    },
  });

// A landscape frame stored sideways: EXIF orientation 6 turns it upright, so
// the red band on the source's left edge ends up along the top.
async function rotatedJpeg(): Promise<Buffer> {
  const band = await sharp({
    create: {
      width: 400,
      height: 1000,
      channels: 3,
      background: { r: 200, g: 40, b: 40 },
    },
  })
    .png()
    .toBuffer();
  return solid(2000, 1000)
    .composite([{ input: band, left: 0, top: 0 }])
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

async function encoded(input: Buffer) {
  const result = await encodeItemPhoto(new Uint8Array(input));
  if (result.kind !== "encoded") throw new Error("expected an encoded photo");
  return { ...result, meta: await sharp(result.bytes).metadata() };
}

const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>',
);

describe("encodeItemPhoto", () => {
  test("auto-orients, fits inside 1,200 px and strips the metadata", async () => {
    const result = await encoded(await rotatedJpeg());

    expect(result.meta.format).toBe("webp");
    expect([result.width, result.height]).toEqual([600, 1200]);
    expect([result.meta.width, result.meta.height]).toEqual([600, 1200]);
    expect(result.meta.exif).toBeUndefined();
    expect(result.meta.orientation).toBeUndefined();
    const { data } = await sharp(result.bytes)
      .extract({ left: 300, top: 10, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeGreaterThan(150);
    expect(data[1]).toBeLessThan(100);
  });

  test("never enlarges a small photo", async () => {
    const result = await encoded(await solid(300, 200).png().toBuffer());
    expect([result.width, result.height]).toEqual([300, 200]);
  });

  test("accepts a WebP, and a PNG at exactly the pixel limit", async () => {
    const webp = await encoded(await solid(1600, 900).webp().toBuffer());
    expect([webp.width, webp.height]).toEqual([1200, 675]);
    const png = await encoded(await solid(2000, 2000).png().toBuffer());
    expect([png.width, png.height]).toEqual([1200, 1200]);
  });

  test.each([
    ["a text file renamed .jpg", async () => Buffer.from("not an image")],
    ["an SVG", async () => SVG],
    ["a GIF", () => solid(20, 20).gif().toBuffer()],
    ["a PNG over 4,000,000 pixels", () => solid(2001, 2000).png().toBuffer()],
    ["an empty input", async () => Buffer.alloc(0)],
  ])("%s → unreadable", async (_case, make) => {
    expect(await encodeItemPhoto(new Uint8Array(await make()))).toEqual({
      kind: "unreadable",
    });
  });
});
