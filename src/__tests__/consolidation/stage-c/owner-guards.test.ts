import { refresh } from "next/cache";
import sharp from "sharp";
import {
  inventoryRows,
  leadingRole,
  serverActionExports,
} from "@/__tests__/support/action-inventory";
import { cookieNames, mockNextRequest } from "@/__tests__/support/next-request";
import { storageControl } from "@/__tests__/support/photo-storage";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import {
  deleteItem,
  hideItem,
  listItem,
  retireOwnItem,
  updateItem,
} from "@/actions/items";
import { uploadItemPhoto } from "@/actions/photos";
import ItemEditSection from "@/components/items/ItemEditSection";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { addDays, communityToday } from "@/lib/dates/dates";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
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

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

// Every owner-guarded action refuses anyone but the owner — another member and
// an organizer alike — as `stale`, with nothing written: the item, its loans,
// the upload log, the outbox and storage stay as they were, and there is no
// refresh(), flash or redirect.

const scope = createTestScope();
const today = communityToday();

beforeAll(assertMigrated);
afterAll(async () => {
  for (const key of storageControl.putKeys) scope.trackPhotoKey(key);
  await scope.cleanup();
});

const asViewer = (
  { id }: { id: string },
  role: ViewerDTO["role"] = "member",
): ViewerDTO => ({
  id,
  displayName: "Mira K.",
  initials: "MK",
  role,
});

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function smallJpeg(): Promise<File> {
  const bytes = await sharp({
    create: {
      width: 64,
      height: 48,
      channels: 3,
      background: { r: 120, g: 150, b: 130 },
    },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(bytes)], "photo.jpg", { type: "image/jpeg" });
}

type Fixture = { ownerId: string; itemId: string };
type Case = {
  action: string;
  // An item in the one state this action's transition accepts.
  arrange: () => Promise<Fixture>;
  call: (itemId: string) => Promise<unknown>;
};

let categoryId: string;
beforeAll(async () => {
  categoryId = (await scope.createCategory("Owner guards")).id;
});

const owner = () => scope.createTestUser({ contactDetails: "Phone" });

const CASES: Case[] = [
  {
    action: "updateItem",
    arrange: async () => {
      const { id: ownerId } = await owner();
      const { id } = await scope.createItem({ ownerId, categoryId });
      return { ownerId, itemId: id };
    },
    call: (id) =>
      updateItem(
        {},
        form({
          id,
          title: "Renamed",
          description: "",
          categoryId,
          condition: "good",
          maxLoanDays: "5",
          pickupNotes: "",
        }),
      ),
  },
  {
    action: "uploadItemPhoto",
    arrange: async () => {
      const { id: ownerId } = await owner();
      const { id } = await scope.createItem({ ownerId, categoryId });
      return { ownerId, itemId: id };
    },
    call: async (id) =>
      uploadItemPhoto({}, form({ id, photo: await smallJpeg() })),
  },
  {
    action: "listItem",
    arrange: async () => {
      const { id: ownerId } = await owner();
      const { id } = await scope.createItem({
        ownerId,
        categoryId,
        photo: true,
      });
      return { ownerId, itemId: id };
    },
    call: (id) => listItem({}, form({ id })),
  },
  {
    action: "hideItem",
    arrange: async () => {
      const { id: ownerId } = await owner();
      const { id } = await scope.createItem({
        ownerId,
        categoryId,
        status: "listed",
        photo: true,
      });
      return { ownerId, itemId: id };
    },
    call: (id) => hideItem({}, form({ id })),
  },
  {
    action: "retireOwnItem",
    arrange: async () => {
      const { id: ownerId } = await owner();
      const borrower = await scope.createTestUser({ contactDetails: "Phone" });
      const { id } = await scope.createItem({
        ownerId,
        categoryId,
        status: "listed",
        photo: true,
      });
      await scope.createLoan({
        itemId: id,
        borrowerId: borrower.id,
        status: "requested",
        startDate: addDays(today, 2),
        endDate: addDays(today, 3),
      });
      return { ownerId, itemId: id };
    },
    call: (id) => retireOwnItem({}, form({ id })),
  },
  {
    action: "deleteItem",
    arrange: async () => {
      const { id: ownerId } = await owner();
      const { id } = await scope.createItem({ ownerId, categoryId });
      return { ownerId, itemId: id };
    },
    call: (id) => deleteItem({}, form({ id })),
  },
];

// Everything a refused call could have written.
async function snapshot({ ownerId, itemId }: Fixture, callerId: string) {
  const item = await db.item.findUnique({ where: { id: itemId } });
  return {
    item,
    loans: await db.loan.findMany({
      where: { itemId },
      orderBy: { id: "asc" },
    }),
    uploads: await db.uploadLog.count({
      where: { userId: { in: [ownerId, callerId] } },
    }),
    outbox: item?.photoKey
      ? await db.pendingBlobDeletion.count({
          where: { storageKey: item.photoKey },
        })
      : 0,
    stored: storageControl.putKeys.length,
  };
}

// Resolves with the action's state, or the error a redirect would throw.
const settle = (promise: Promise<unknown>) =>
  promise.then(
    (state) => ({ state }),
    (error: unknown) => ({ error }),
  );

describe("owner guards — the derived set", () => {
  test("the inventory's owner rows, among exported actions, are the six", () => {
    const exported = new Set(serverActionExports().map(({ name }) => name));
    const ownerRows = inventoryRows()
      .filter((row) => leadingRole(row.auth) === "owner")
      .map(({ name }) => name)
      .filter((name) => exported.has(name))
      .sort();
    expect(ownerRows).toEqual(CASES.map(({ action }) => action).sort());
  });
});

describe.each(CASES)("$action", ({ arrange, call }) => {
  test("the owner's call on an identical fixture is not refused as stale (positive control)", async () => {
    const fixture = await arrange();
    vi.mocked(getViewer).mockResolvedValue(asViewer({ id: fixture.ownerId }));
    mockNextRequest();

    const result = await settle(call(fixture.itemId));
    expect(result).not.toEqual({ state: { formError: "stale" } });
  });

  test.each(["member", "organizer"] as const)(
    "a %s who doesn't own the item gets stale, with nothing written",
    async (role) => {
      const fixture = await arrange();
      const caller = await scope.createTestUser({
        role,
        contactDetails: "Phone",
      });
      vi.mocked(getViewer).mockResolvedValue(asViewer(caller, role));
      mockNextRequest();
      const before = await snapshot(fixture, caller.id);

      const result = await settle(call(fixture.itemId));

      expect(result).toEqual({ state: { formError: "stale" } });
      expect(await snapshot(fixture, caller.id)).toEqual(before);
      expect(vi.mocked(refresh)).not.toHaveBeenCalled();
      expect(cookieNames()).not.toContain(FLASH_COOKIE);
    },
  );
});

describe("ItemEditSection", () => {
  test.each(["member", "organizer"] as const)(
    "is not-found for a %s who doesn't own the item",
    async (role) => {
      const { id: ownerId } = await owner();
      const { id } = await scope.createItem({ ownerId, categoryId });
      const caller = await scope.createTestUser({ role });
      vi.mocked(getViewer).mockResolvedValue(asViewer(caller, role));

      const error = await ItemEditSection({
        params: Promise.resolve({ id }),
      }).then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect((error as { digest?: string } | null)?.digest).toBe(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    },
  );
});
