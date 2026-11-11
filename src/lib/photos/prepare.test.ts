// @vitest-environment jsdom
import { CLIENT_PHOTO_MAX_BYTES } from "./limits";
import { preparePhotoForUpload } from "./prepare";

// jsdom has no decoder and no canvas pixels: both are stubbed, and the blob
// size each encode returns comes from `sizeFor(width, quality)`.
type Encode = { width: number; height: number; quality: number };

let encodes: Encode[];
let sizeFor: (width: number, quality: number) => number | null;
let bitmap: { width: number; height: number; close: ReturnType<typeof vi.fn> };
const file = new File(["raw"], "IMG_0001.jpg", { type: "image/jpeg" });

beforeEach(() => {
  encodes = [];
  sizeFor = () => 100_000;
  bitmap = { width: 4000, height: 3000, close: vi.fn() };
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => bitmap),
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () =>
      ({
        fillStyle: "",
        fillRect: vi.fn(),
        drawImage: vi.fn(),
      }) as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (
    this: HTMLCanvasElement,
    callback,
    type,
    quality,
  ) {
    expect(type).toBe("image/jpeg");
    encodes.push({
      width: this.width,
      height: this.height,
      quality: quality as number,
    });
    const size = sizeFor(this.width, quality as number);
    callback(size === null ? null : new Blob([new Uint8Array(size)]));
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("preparePhotoForUpload", () => {
  test("decodes with EXIF orientation, fits 1,600 px and stops at the first quality that fits", async () => {
    const result = await preparePhotoForUpload(file);

    expect(result.kind).toBe("ready");
    expect(createImageBitmap).toHaveBeenCalledWith(file, {
      imageOrientation: "from-image",
    });
    expect(encodes).toEqual([{ width: 1600, height: 1200, quality: 0.85 }]);
    expect(bitmap.close).toHaveBeenCalled();
  });

  test("steps the quality down 0.85 → 0.75 → 0.65 until it is ≤ 900 KB", async () => {
    sizeFor = (_width, quality) =>
      quality > 0.7 ? CLIENT_PHOTO_MAX_BYTES + 1 : CLIENT_PHOTO_MAX_BYTES;

    const result = await preparePhotoForUpload(file);

    expect(result.kind).toBe("ready");
    expect(encodes.map(({ quality }) => quality)).toEqual([0.85, 0.75, 0.65]);
    if (result.kind === "ready") {
      expect(result.blob.size).toBe(CLIENT_PHOTO_MAX_BYTES);
    }
  });

  test("then scales the edge by 0.75 and starts the qualities again", async () => {
    sizeFor = (width) => (width > 900 ? 2_000_000 : 50_000);

    const result = await preparePhotoForUpload(file);

    expect(result.kind).toBe("ready");
    const edges = [...new Set(encodes.map(({ width }) => width))];
    expect(edges).toEqual([1600, 1200, 900]);
    expect(encodes.at(-1)).toEqual({ width: 900, height: 675, quality: 0.85 });
  });

  test("gives up after three edge steps", async () => {
    sizeFor = () => 2_000_000;

    expect(await preparePhotoForUpload(file)).toEqual({ kind: "failed" });
    expect([...new Set(encodes.map(({ width }) => width))]).toEqual([
      1600, 1200, 900, 675,
    ]);
    expect(encodes).toHaveLength(16);
    expect(bitmap.close).toHaveBeenCalled();
  });

  test("never enlarges a small photo", async () => {
    bitmap = { width: 800, height: 600, close: vi.fn() };

    await preparePhotoForUpload(file);

    expect(encodes[0]).toMatchObject({ width: 800, height: 600 });
  });

  test("a file the browser can't decode fails and draws nothing", async () => {
    vi.mocked(createImageBitmap).mockRejectedValueOnce(new DOMException("bad"));

    expect(await preparePhotoForUpload(file)).toEqual({ kind: "failed" });
    expect(encodes).toEqual([]);
  });

  test("an encoder that returns no blob fails, and the bitmap is still closed", async () => {
    sizeFor = () => null;

    expect(await preparePhotoForUpload(file)).toEqual({ kind: "failed" });
    expect(bitmap.close).toHaveBeenCalled();
  });
});
