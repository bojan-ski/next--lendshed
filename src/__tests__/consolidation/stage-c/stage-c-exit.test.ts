import { isRedirectError } from "next/dist/client/components/redirect-error";
import sharp from "sharp";
import { mockNextRequest } from "@/__tests__/support/next-request";
import { storageControl } from "@/__tests__/support/photo-storage";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { createItem, listItem } from "@/actions/items";
import { uploadItemPhoto } from "@/actions/photos";
import { getBrowseItems, getItemForViewer } from "@/data/browse";
import { isDatesTaken } from "@/data/db-errors";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { addDays, communityToday } from "@/lib/dates/dates";
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

// The Build Stages exit condition for Stage C, through the actions. Hidden,
// retired and suspended-owner not-found: visibility-scope.test.ts. Each upload
// cap: cap-refusals.test.ts. The categories pairing: categories-pairing.test.ts.

const scope = createTestScope();
const today = communityToday();
const term = `${scope.tag}exit`;

beforeAll(assertMigrated);
afterAll(async () => {
  for (const key of storageControl.putKeys) scope.trackPhotoKey(key);
  await scope.cleanup();
});

const asViewer = ({ id }: { id: string }): ViewerDTO => ({
  id,
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
});

function form(fields: Record<string, string | File>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected a redirect");
    },
    (thrown: unknown) => thrown,
  );
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

async function photo(): Promise<File> {
  const bytes = await sharp({
    create: {
      width: 800,
      height: 600,
      channels: 3,
      background: { r: 110, g: 140, b: 160 },
    },
  })
    .jpeg()
    .toBuffer();
  return new File([new Uint8Array(bytes)], "photo.jpg", { type: "image/jpeg" });
}

test("a member lists a photographed item, another finds it free, then booked, then behind an overdue loan, and an overlap is refused by the database", async () => {
  const { id: categoryId } = await scope.createCategory("Exit");
  const lender = await scope.createTestUser({ contactDetails: "Phone" });
  const borrower = await scope.createTestUser({ contactDetails: "Phone" });

  // Create → photograph → list, as the lender.
  vi.mocked(getViewer).mockResolvedValue(asViewer(lender));
  mockNextRequest();
  const target = await redirectTarget(
    createItem(
      {},
      form({
        title: `${term} hedge trimmer`,
        description: "Cordless",
        categoryId,
        condition: "good",
        maxLoanDays: "5",
        pickupNotes: "",
      }),
    ),
  );
  const itemId = /^\/my\/items\/([^/]+)\/edit$/.exec(target)?.[1];
  expect(itemId).toBeDefined();

  expect(
    await uploadItemPhoto({}, form({ id: itemId!, photo: await photo() })),
  ).not.toHaveProperty("formError");
  expect(await listItem({}, form({ id: itemId! }))).not.toHaveProperty(
    "formError",
  );
  expect(
    await db.item.findUniqueOrThrow({
      where: { id: itemId },
      select: { status: true },
    }),
  ).toEqual({ status: "listed" });

  // Another member finds it by search and category, free today.
  const find = async () =>
    (
      await getBrowseItems(
        borrower.id,
        { q: term, category: categoryId, page: 1 },
        today,
      )
    ).items;
  expect(await find()).toMatchObject([{ id: itemId, freeToday: true }]);

  // Approved over today: not free, and an "Already booked" range.
  const bookedStart = addDays(today, -1);
  const bookedEnd = addDays(today, 1);
  await scope.createLoan({
    itemId: itemId!,
    borrowerId: borrower.id,
    status: "approved",
    startDate: bookedStart,
    endDate: bookedEnd,
  });
  expect(await find()).toMatchObject([{ id: itemId, freeToday: false }]);

  // An overdue out loan, ended before that range: still out, listed first.
  const overdueStart = addDays(today, -6);
  const overdueEnd = addDays(today, -3);
  await scope.createLoan({
    itemId: itemId!,
    borrowerId: borrower.id,
    status: "out",
    startDate: overdueStart,
    endDate: overdueEnd,
  });
  const detail = await getItemForViewer(asViewer(borrower), itemId!, today);
  expect(detail?.bookedRanges).toEqual([
    { startDate: overdueStart, endDate: overdueEnd, stillOut: true },
    { startDate: bookedStart, endDate: bookedEnd, stillOut: false },
  ]);

  // A direct overlapping approved/out insert fails in the database (23P01).
  const error = await scope
    .createLoan({
      itemId: itemId!,
      borrowerId: borrower.id,
      status: "out",
      startDate: today,
      endDate: addDays(today, 2),
    })
    .then(
      () => null,
      (thrown: unknown) => thrown,
    );
  expect(error).not.toBeNull();
  expect(isDatesTaken(error)).toBe(true);
});
