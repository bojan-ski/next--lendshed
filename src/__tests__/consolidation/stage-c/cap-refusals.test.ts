import type { ReactNode } from "react";
import { prerender } from "react-dom/static";
import sharp from "sharp";
import { mockNextRequest } from "@/__tests__/support/next-request";
import { storageControl } from "@/__tests__/support/photo-storage";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { createItem } from "@/actions/items";
import { uploadItemPhoto } from "@/actions/photos";
import NewItemSection from "@/components/items/NewItemSection";
import { getBrowseItems } from "@/data/browse";
import { getUploadCounts } from "@/data/photos";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import {
  addDays,
  communityMidnight,
  communityToday,
  firstOfNextMonth,
  formatDate,
} from "@/lib/dates/dates";
import { UPLOAD_LIMITS } from "@/lib/photos/caps";
import { ITEM_CAP } from "@/lib/schemas/items";
import { t } from "@/lib/text/interpolate";
import { items } from "@/strings/items";
import type { ViewerDTO } from "@/types/viewer";

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
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
// Spied, not replaced: real counts unless a test overrides one call.
vi.mock("@/data/photos", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/photos")>();
  return { ...actual, getUploadCounts: vi.fn(actual.getUploadCounts) };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Each cap refuses with its key and writes nothing, and browsing keeps working.
// The item and daily caps run on real rows; the monthly and storage caps are
// app-wide, so getUploadCounts is mocked for them (the shared database can't be
// driven there without global counts); spec 11's uploadCapRefusal table is
// their invariant proof.

const scope = createTestScope();
const today = communityToday();
const term = `${scope.tag}cap`;

let categoryId: string;
let browser: ViewerDTO;
let listedId: string;

const asViewer = ({ id }: { id: string }): ViewerDTO => ({
  id,
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
  needsActionCount: 0,
});

beforeAll(async () => {
  await assertMigrated();
  categoryId = (await scope.createCategory("Caps")).id;
  const lender = await scope.createTestUser({ contactDetails: "Phone" });
  listedId = (
    await scope.createItem({
      ownerId: lender.id,
      categoryId,
      status: "listed",
      photo: true,
      title: `${term} listed`,
    })
  ).id;
  browser = asViewer(await scope.createTestUser());
});
afterAll(async () => {
  for (const key of storageControl.putKeys) scope.trackPhotoKey(key);
  await scope.cleanup();
});

async function expectBrowsingIntact() {
  const page = await getBrowseItems(
    browser.id,
    { q: term, category: null, page: 1 },
    today,
  );
  expect(page.items.map(({ id }) => id)).toEqual([listedId]);
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

async function html(tree: unknown): Promise<string> {
  const { prelude } = await prerender(tree as ReactNode);
  return (await new Response(prelude).text())
    .replace(/<!-- -->/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
}

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("item cap", () => {
  test(`at ${ITEM_CAP} non-retired items createItem refuses capReached, writes nothing, and Add item shows the notice`, async () => {
    const member = await scope.createTestUser();
    for (let n = 0; n < ITEM_CAP; n += 1) {
      await scope.createItem({ ownerId: member.id, categoryId });
    }
    // A retired item doesn't count, so it doesn't change the outcome either.
    await scope.createItem({
      ownerId: member.id,
      categoryId,
      status: "retired",
    });
    vi.mocked(getViewer).mockResolvedValue(asViewer(member));
    mockNextRequest();
    const count = () => db.item.count({ where: { ownerId: member.id } });
    const before = await count();

    const state = await createItem(
      {},
      form({
        title: "One too many",
        description: "",
        categoryId,
        condition: "good",
        maxLoanDays: "3",
        pickupNotes: "",
      }),
    );

    expect(state).toMatchObject({ formError: "capReached" });
    expect(await count()).toBe(before);
    const page = await html(await NewItemSection());
    expect(page).toContain(t(items.capNotice, { cap: ITEM_CAP }));
    expect(page).not.toContain("<form");
    await expectBrowsingIntact();
  });
});

describe("upload caps", () => {
  async function ownHiddenItem() {
    const member = await scope.createTestUser({ contactDetails: "Phone" });
    const { id } = await scope.createItem({ ownerId: member.id, categoryId });
    vi.mocked(getViewer).mockResolvedValue(asViewer(member));
    mockNextRequest();
    return { memberId: member.id, itemId: id };
  }

  async function photo(): Promise<File> {
    const bytes = await sharp({
      create: {
        width: 64,
        height: 48,
        channels: 3,
        background: { r: 150, g: 120, b: 130 },
      },
    })
      .jpeg()
      .toBuffer();
    return new File([new Uint8Array(bytes)], "photo.jpg", {
      type: "image/jpeg",
    });
  }

  async function snapshot(memberId: string, itemId: string) {
    const item = await db.item.findUniqueOrThrow({
      where: { id: itemId },
      select: {
        photoKey: true,
        photoUrl: true,
        photoWidth: true,
        photoHeight: true,
        photoBytes: true,
      },
    });
    return {
      item,
      uploads: await db.uploadLog.count({ where: { userId: memberId } }),
      stored: storageControl.putKeys.length,
    };
  }

  async function refuse(memberId: string, itemId: string) {
    const before = await snapshot(memberId, itemId);
    const state = await uploadItemPhoto(
      {},
      form({ id: itemId, photo: await photo() }),
    );
    // Photo columns, upload log and storage unchanged. The item had no photo
    // and no key was stored, so the outbox can hold nothing from this call.
    expect(await snapshot(memberId, itemId)).toEqual(before);
    await expectBrowsingIntact();
    return state;
  }

  test(`the daily cap: ${UPLOAD_LIMITS.dailyPerMember} uploads since community midnight → dailyCap, reopening tomorrow`, async () => {
    const { memberId, itemId } = await ownHiddenItem();
    const since = communityMidnight(today);
    await db.uploadLog.createMany({
      data: Array.from({ length: UPLOAD_LIMITS.dailyPerMember }, () => ({
        userId: memberId,
        bytes: 1_000,
        createdAt: since,
      })),
    });

    expect(await refuse(memberId, itemId)).toEqual({
      formError: "dailyCap",
      reopensOnLabel: formatDate(addDays(today, 1), today),
    });
  });

  test("the monthly cap (counts mocked) → monthlyCap, reopening on the 1st", async () => {
    const { memberId, itemId } = await ownHiddenItem();
    vi.mocked(getUploadCounts).mockResolvedValueOnce({
      monthCount: UPLOAD_LIMITS.monthly,
      dayCount: 0,
      storedBytes: 0,
    });

    expect(await refuse(memberId, itemId)).toEqual({
      formError: "monthlyCap",
      reopensOnLabel: formatDate(firstOfNextMonth(today), today),
    });
  });

  test("the storage cap (counts mocked) → storageFull, with no reopen date", async () => {
    const { memberId, itemId } = await ownHiddenItem();
    vi.mocked(getUploadCounts).mockResolvedValueOnce({
      monthCount: 0,
      dayCount: 0,
      storedBytes: UPLOAD_LIMITS.storedBytes,
    });

    expect(await refuse(memberId, itemId)).toEqual({
      formError: "storageFull",
    });
  });

  test("below every cap the same upload goes through (positive control)", async () => {
    const { memberId, itemId } = await ownHiddenItem();
    await db.uploadLog.createMany({
      data: Array.from({ length: UPLOAD_LIMITS.dailyPerMember - 1 }, () => ({
        userId: memberId,
        bytes: 1_000,
        createdAt: communityMidnight(today),
      })),
    });

    const state = await uploadItemPhoto(
      {},
      form({ id: itemId, photo: await photo() }),
    );
    expect(state).not.toHaveProperty("formError");
    expect(await db.uploadLog.count({ where: { userId: memberId } })).toBe(
      UPLOAD_LIMITS.dailyPerMember,
    );
  });
});
