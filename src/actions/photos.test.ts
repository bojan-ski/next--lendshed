import { readFile } from "node:fs/promises";
import { refresh, updateTag } from "next/cache";
import sharp from "sharp";
import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  storageControl,
  storedFileSize,
} from "@/__tests__/support/photo-storage";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { retireItemByOwner } from "@/data/items";
import { attachItemPhoto, getUploadCounts } from "@/data/photos";
import { db } from "@/db";
import {
  addDays,
  communityMidnight,
  communityToday,
  firstOfMonth,
  firstOfNextMonth,
  formatDate,
} from "@/lib/dates/dates";
import { photos } from "@/strings/photos";
import { listItem } from "./items";
import { uploadItemPhoto } from "./photos";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/photos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/photos")>();
  return {
    ...actual,
    getUploadCounts: vi.fn(actual.getUploadCounts),
    attachItemPhoto: vi.fn(actual.attachItemPhoto),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const idle = {};

beforeAll(assertMigrated);
afterEach(() => {
  storageControl.reset();
  vi.restoreAllMocks();
});
// Every key the action stored, wherever the test left it.
afterAll(async () => {
  for (const key of storageControl.putKeys) scope.trackPhotoKey(key);
  await scope.cleanup();
});

async function actAs(contactDetails: string | null = null) {
  const user = await scope.createTestUser({ contactDetails });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

// A sideways landscape JPEG (EXIF 6), as a phone camera writes it.
async function cameraJpeg(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1600,
      height: 900,
      channels: 3,
      background: { r: 90, g: 140, b: 110 },
    },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
}

const asFile = (bytes: Buffer | string, type = "image/jpeg") =>
  new File(
    [typeof bytes === "string" ? bytes : new Uint8Array(bytes)],
    "photo.jpg",
    {
      type,
    },
  );

function upload(
  id: string,
  photo: File | null,
  extra: Record<string, string> = {},
) {
  const data = new FormData();
  data.set("id", id);
  if (photo) data.set("photo", photo);
  for (const [name, value] of Object.entries(extra)) data.set(name, value);
  return uploadItemPhoto(idle, data);
}

const itemRow = (id: string) => db.item.findUniqueOrThrow({ where: { id } });
const uploadRows = (userId: string) =>
  db.uploadLog.findMany({ where: { userId }, select: { bytes: true } });
const queueRow = (storageKey: string) =>
  db.pendingBlobDeletion.findUnique({ where: { storageKey } });

describe("uploadItemPhoto — saved", () => {
  test("stores an upright WebP ≤ 1,200 px, logs it once, keeps the status", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });

    const state = await upload(id, asFile(await cameraJpeg()), {
      photoKey: "items/forged.webp",
      photoUrl: "https://example.test/x.webp",
      photoBytes: "1",
      ownerId: crypto.randomUUID(),
      status: "listed",
    });

    expect(state).toEqual({ flash: "photoSaved" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(updateTag).not.toHaveBeenCalled();
    const row = await itemRow(id);
    expect(row.status).toBe("hidden");
    expect(row.photoKey).toMatch(/^items\/[0-9a-f-]{36}\.webp$/);
    expect(row.photoUrl).toBe(`/uploads/${row.photoKey}`);
    expect([row.photoWidth, row.photoHeight]).toEqual([675, 1200]);
    expect(await storedFileSize(row.photoKey!)).toBe(row.photoBytes);
    // Read first: sharp holds a path's file open on Windows (EBUSY on cleanup).
    const meta = await sharp(
      await readFile(`public/uploads/${row.photoKey}`),
    ).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined();
    expect(await uploadRows(viewer.id)).toEqual([{ bytes: row.photoBytes }]);
    expect(await queueRow(row.photoKey!)).toBeNull();
  });

  test("a listed item stays listed, and its old photo is deleted after commit", async () => {
    const viewer = await actAs();
    const old = await scope.createStoredPhoto();
    const { id } = await scope.createItem({
      ownerId: viewer.id,
      status: "listed",
      photo: old,
    });
    const before = await itemRow(id);

    expect(await upload(id, asFile(await cameraJpeg()))).toEqual({
      flash: "photoSaved",
    });

    const row = await itemRow(id);
    expect(row.status).toBe("listed");
    expect(row.listedAt).toEqual(before.listedAt);
    expect(row.photoKey).not.toBe(old.photoKey);
    expect(await storedFileSize(old.photoKey)).toBeNull();
    expect(await queueRow(old.photoKey)).toBeNull();
  });

  test("an old file that fails to delete stays queued; the upload still succeeds", async () => {
    const viewer = await actAs();
    const old = await scope.createStoredPhoto();
    const { id } = await scope.createItem({ ownerId: viewer.id, photo: old });
    storageControl.failDelete = new Error("storage down");

    expect(await upload(id, asFile(await cameraJpeg()))).toEqual({
      flash: "photoSaved",
    });
    expect(await queueRow(old.photoKey)).toMatchObject({
      attempts: 1,
      lastError: "Error: storage down",
    });
  });

  test("listItem succeeds after an upload when contact details exist", async () => {
    const viewer = await actAs("Phone 555 0100");
    const { id } = await scope.createItem({ ownerId: viewer.id });
    const listForm = new FormData();
    listForm.set("id", id);

    expect(await listItem(idle, listForm)).toEqual({
      formError: "needsPhoto",
    });
    await upload(id, asFile(await cameraJpeg()));
    expect(await listItem(idle, listForm)).toEqual({ flash: "itemListed" });
  });
});

describe("uploadItemPhoto — stale", () => {
  test("someone else's, an unknown, an empty id or a retired item; nothing written", async () => {
    const viewer = await actAs();
    const others = await scope.createItem({
      ownerId: (await scope.createTestUser()).id,
    });
    const retired = await scope.createItem({
      ownerId: viewer.id,
      status: "retired",
    });
    const photo = asFile(await cameraJpeg());

    for (const id of [others.id, crypto.randomUUID(), "", retired.id]) {
      expect(await upload(id, photo)).toEqual({ formError: "stale" });
    }
    expect((await itemRow(others.id)).photoKey).toBeNull();
    expect(await uploadRows(viewer.id)).toEqual([]);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a bad id is stale even when the photo is also invalid", async () => {
    await actAs();
    expect(await upload("", null)).toEqual({ formError: "stale" });
  });

  test("a retire committed between the pre-check and the attach: the new file is deleted, the old photo kept", async () => {
    const viewer = await actAs();
    const old = await scope.createStoredPhoto();
    const { id } = await scope.createItem({ ownerId: viewer.id, photo: old });
    vi.mocked(attachItemPhoto).mockImplementationOnce(async (...args) => {
      // Retire the item without its own photo cleanup reaching the old file:
      // the point is the attach seeing a retired row.
      await db.item.update({ where: { id }, data: { status: "retired" } });
      const { attachItemPhoto: actual } =
        await vi.importActual<typeof import("@/data/photos")>("@/data/photos");
      return actual(...args);
    });

    expect(await upload(id, asFile(await cameraJpeg()))).toEqual({
      formError: "stale",
    });

    const newKey = storageControl.putKeys.at(-1)!;
    expect(await storedFileSize(newKey)).toBeNull();
    expect(await queueRow(newKey)).toBeNull();
    expect((await itemRow(id)).photoKey).toBe(old.photoKey);
    // The upload was counted: the log row stays.
    expect(await uploadRows(viewer.id)).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a real owner retire between pre-check and attach is also stale", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });
    vi.mocked(attachItemPhoto).mockImplementationOnce(async (...args) => {
      await retireItemByOwner(viewer.id, id, communityToday());
      const { attachItemPhoto: actual } =
        await vi.importActual<typeof import("@/data/photos")>("@/data/photos");
      return actual(...args);
    });

    expect(await upload(id, asFile(await cameraJpeg()))).toEqual({
      formError: "stale",
    });
    expect((await itemRow(id)).photoKey).toBeNull();
  });
});

describe("uploadItemPhoto — field errors", () => {
  test.each([
    ["no file", () => null, photos.photoRequired],
    ["an empty file", () => asFile(""), photos.photoRequired],
    [
      "a file over 1,048,576 bytes",
      () => asFile(Buffer.alloc(1_048_577)),
      photos.photoTooLarge,
    ],
    [
      "a non-image type",
      () => asFile("hello", "text/plain"),
      photos.photoNotImage,
    ],
  ])(
    "%s → fieldErrors.photo, nothing written",
    async (_case, make, message) => {
      const viewer = await actAs();
      const { id } = await scope.createItem({ ownerId: viewer.id });

      const state = await upload(id, make());

      expect(state).toEqual({ fieldErrors: { photo: [message] } });
      expect((await itemRow(id)).photoKey).toBeNull();
      expect(await uploadRows(viewer.id)).toEqual([]);
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});

describe("uploadItemPhoto — unreadable", () => {
  const solid = (width: number, height: number) =>
    sharp({
      create: { width, height, channels: 3, background: { r: 1, g: 2, b: 3 } },
    });

  test.each([
    ["a text file renamed .jpg", async () => Buffer.from("not an image")],
    [
      "an SVG",
      async () =>
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="9" height="9"/>',
        ),
    ],
    ["a GIF", () => solid(10, 10).gif().toBuffer()],
    [
      "an image over 4,000,000 pixels",
      () => solid(2500, 2000).png().toBuffer(),
    ],
  ])("%s → unreadable, no upload logged", async (_case, make) => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });
    const before = storageControl.putKeys.length;

    expect(await upload(id, asFile(await make()))).toEqual({
      formError: "unreadable",
    });
    expect(await uploadRows(viewer.id)).toEqual([]);
    expect(storageControl.putKeys).toHaveLength(before);
  });
});

describe("uploadItemPhoto — caps", () => {
  const counts = { monthCount: 0, dayCount: 0, storedBytes: 0 };

  test.each([
    [
      "monthly",
      { ...counts, monthCount: 1500 },
      "monthlyCap",
      (today: string) => formatDate(firstOfNextMonth(today), today),
    ],
    [
      "daily",
      { ...counts, dayCount: 20 },
      "dailyCap",
      (today: string) => formatDate(addDays(today, 1), today),
    ],
  ] as const)(
    "%s → %s with the reopen date; nothing decoded or written",
    async (_case, refused, formError, label) => {
      const viewer = await actAs();
      const { id } = await scope.createItem({ ownerId: viewer.id });
      vi.mocked(getUploadCounts).mockResolvedValueOnce(refused);

      const state = await upload(id, asFile("not even an image"));

      expect(state).toEqual({
        formError,
        reopensOnLabel: label(communityToday()),
      });
      expect(await uploadRows(viewer.id)).toEqual([]);
    },
  );

  test("storage full → storageFull with no date", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });
    vi.mocked(getUploadCounts).mockResolvedValueOnce({
      ...counts,
      storedBytes: 800_000_000,
    });

    expect(await upload(id, asFile(await cameraJpeg()))).toEqual({
      formError: "storageFull",
    });
  });

  test("the counts are taken from community midnight and the first of the month", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });
    vi.mocked(getUploadCounts).mockResolvedValueOnce({
      ...counts,
      dayCount: 20,
    });

    const today = communityToday();
    await upload(id, asFile(await cameraJpeg()));

    const [userId, since] = vi.mocked(getUploadCounts).mock.calls[0];
    expect(userId).toBe(viewer.id);
    expect(since).toEqual({
      monthStart: communityMidnight(firstOfMonth(today)),
      dayStart: communityMidnight(today),
    });
  });
});

describe("uploadItemPhoto — storage failure", () => {
  test("a failed put → unexpected; the reservation is drained, the log row stays", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });
    storageControl.failPut = true;

    expect(await upload(id, asFile(await cameraJpeg()))).toEqual({
      formError: "unexpected",
    });

    const key = storageControl.putKeys.at(-1)!;
    expect(await queueRow(key)).toBeNull();
    expect(await uploadRows(viewer.id)).toHaveLength(1);
    expect((await itemRow(id)).photoKey).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });

  // The reservation made before storing keeps the stored file referenced:
  // never an orphan the daily job can't find (12a, test-coverage-auditor).
  test("an attach that throws after the put → unexpected; the stored file stays queued", async () => {
    const viewer = await actAs();
    const { id } = await scope.createItem({ ownerId: viewer.id });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(attachItemPhoto).mockRejectedValueOnce(new Error("lost"));

    expect(await upload(id, asFile(await cameraJpeg()))).toEqual({
      formError: "unexpected",
    });

    const key = storageControl.putKeys.at(-1)!;
    const [logged] = await uploadRows(viewer.id);
    expect(await queueRow(key)).toMatchObject({ bytes: logged.bytes });
    expect(await storedFileSize(key)).toBe(logged.bytes);
    expect((await itemRow(id)).photoKey).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  });
});
