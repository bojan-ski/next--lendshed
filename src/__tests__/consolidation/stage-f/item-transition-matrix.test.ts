import { refresh } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { inventoryRows } from "@/__tests__/support/action-inventory";
import {
  createLoanFixture,
  createLoanParties,
  FIXTURE_INSTANT,
  type LoanParties,
} from "@/__tests__/support/loan-fixtures";
import { inBatches, trackItemPhoto } from "@/__tests__/support/member-fixtures";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { deleteItem, hideItem, listItem, retireOwnItem } from "@/actions/items";
import { getItemForEdit } from "@/data/items";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { ItemStatus } from "@/generated/prisma/enums";
import { communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import { loanStatus } from "@/lib/text/status";
import type { ItemEditDTO } from "@/types/item";
import type { EffectiveLoanStatus } from "@/types/loan";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, redirect: vi.fn(actual.redirect) };
});
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/feedback/flash", () => ({ setFlash: vi.fn() }));
vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 });

// Every owner item transition × stored item status × loan context (spec 24),
// the item counterpart of stage-d/transition-matrix: the action accepts exactly
// the oracle's cells, a refusal writes nothing and fires no signal, and the Edit
// page offers a control exactly where its action accepts it. The oracle is the
// Item Lifecycle and the inventory, nothing else. retireItemAsOrganizer keeps
// its own coverage (data/items, stage-e/organizer-guard-matrix).

type Transition = "listItem" | "hideItem" | "retireOwnItem" | "deleteItem";
type Context = "none" | EffectiveLoanStatus;
type Outcome = "accepted" | "stale" | "blocked" | "hasLoans";

const TRANSITIONS: Transition[] = [
  "listItem",
  "hideItem",
  "retireOwnItem",
  "deleteItem",
];
const STATUSES = Object.values(ItemStatus);
const CONTEXTS: Context[] = [
  "none",
  ...(Object.keys(loanStatus) as EffectiveLoanStatus[]),
];

// A lapsed approval doesn't block a retire (the Item Lifecycle).
const BLOCKING = new Set<Context>(["approved", "out", "overdue"]);

// A status refusal comes before a loan refusal.
function outcome(
  transition: Transition,
  status: ItemStatus,
  context: Context,
): Outcome {
  switch (transition) {
    case "listItem":
      return status === "hidden" ? "accepted" : "stale";
    case "hideItem":
      return status === "listed" ? "accepted" : "stale";
    case "retireOwnItem":
      if (status === "retired") return "stale";
      return BLOCKING.has(context) ? "blocked" : "accepted";
    case "deleteItem":
      if (status === "retired") return "stale";
      return context === "none" ? "accepted" : "hasLoans";
  }
}

const TARGET: Record<Exclude<Transition, "deleteItem">, ItemStatus> = {
  listItem: "listed",
  hideItem: "hidden",
  retireOwnItem: "retired",
};
const SUCCESS_FLASH = {
  listItem: "itemListed",
  hideItem: "itemHidden",
  retireOwnItem: "itemRetired",
} as const;
const SWEEP = {
  hideItem: "item_hidden",
  retireOwnItem: "item_retired",
} as const;

// The controls the Edit page renders on these flags (ItemEditSection: one
// visibility control, then exactly one of Delete or Retire, nothing once
// retired; the flags-to-controls mapping is pinned by its section tests).
function offered(dto: ItemEditDTO): Transition[] {
  if (dto.status === "retired") return [];
  const visibility = dto.status === "hidden" ? "listItem" : "hideItem";
  if (!dto.hasAnyLoan) return [visibility, "deleteItem"];
  if (!dto.hasBlockingLoan) return [visibility, "retireOwnItem"];
  return [visibility];
}

// The page offers Delete, not Retire, on a zero-loan item (page 10), though the
// action would accept the retire: the one stated asymmetry.
const offeredWhenAccepted = (transition: Transition, context: Context) =>
  !(transition === "retireOwnItem" && context === "none");

const scope = createTestScope();
let parties: LoanParties;
let today: string;

type Fixture = { itemId: string; loanId: string | null };

// The owner has contact details and every item has a photo.
async function fixture(status: ItemStatus, context: Context): Promise<Fixture> {
  if (context === "none") {
    const { id } = await scope.createItem({
      ownerId: parties.owner.id,
      status,
      photo: true,
    });
    await trackItemPhoto(scope, id);
    return { itemId: id, loanId: null };
  }
  const { id, itemId } = await createLoanFixture(
    scope,
    parties,
    context,
    today,
    { itemStatus: status },
  );
  await trackItemPhoto(scope, itemId);
  return { itemId, loanId: id };
}

// Every column of the item, its loan and its photo's queue row.
async function footprint(
  { itemId, loanId }: Fixture,
  photoKey?: string | null,
) {
  const item = await db.item.findUnique({ where: { id: itemId } });
  const key = photoKey ?? item?.photoKey;
  const [loan, queue] = await Promise.all([
    loanId ? db.loan.findUnique({ where: { id: loanId } }) : null,
    key ? db.pendingBlobDeletion.findMany({ where: { storageKey: key } }) : [],
  ]);
  return { item, loan, queue };
}

const idForm = (id: string) => {
  const data = new FormData();
  data.set("id", id);
  return data;
};

type Run = { state?: object; redirectedTo?: string };

async function run(transition: Transition, itemId: string): Promise<Run> {
  const data = idForm(itemId);
  try {
    switch (transition) {
      case "listItem":
        return { state: await listItem({}, data) };
      case "hideItem":
        return { state: await hideItem({}, data) };
      case "retireOwnItem":
        return { state: await retireOwnItem({}, data) };
      case "deleteItem":
        return { state: await deleteItem({}, data) };
    }
  } catch (error) {
    if (!isRedirectError(error)) throw error;
    return { redirectedTo: vi.mocked(redirect).mock.calls[0]?.[0] };
  }
}

const shared = new Map<string, Fixture>();
const key = (status: ItemStatus, context: Context) => `${status}/${context}`;

beforeAll(async () => {
  // One frozen instant: actions and fixtures agree on today all run long.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date());
  today = communityToday();
  await assertMigrated();
  parties = await createLoanParties(scope);
  // One per (status, context): refusals write nothing (each cell asserts it)
  // and the page only reads.
  const pairs = STATUSES.flatMap((status) =>
    CONTEXTS.map((context) => [status, context] as const),
  );
  await inBatches(pairs, async ([status, context]) => {
    shared.set(key(status, context), await fixture(status, context));
  });
});
beforeEach(() => {
  vi.mocked(getViewer).mockResolvedValue(parties.owner);
});
afterAll(async () => {
  vi.useRealTimers();
  await scope.cleanup();
});

describe("the derived dimensions", () => {
  test("the transitions are the item actions whose input is itemIdSchema", () => {
    expect(
      inventoryRows()
        .filter(({ input }) => input.startsWith("`itemIdSchema`"))
        .map(({ name }) => name)
        .sort(),
    ).toEqual([...TRANSITIONS].sort());
  });

  test("4 transitions × 3 stored statuses × 10 loan contexts = 120 cells", () => {
    expect([...STATUSES].sort()).toEqual(["hidden", "listed", "retired"]);
    expect(CONTEXTS).toHaveLength(10);
    expect(TRANSITIONS.length * STATUSES.length * CONTEXTS.length).toBe(120);
  });
});

async function expectRefused(
  transition: Transition,
  status: ItemStatus,
  context: Context,
  expected: Exclude<Outcome, "accepted">,
) {
  const cell = shared.get(key(status, context));
  if (!cell) throw new Error(`no fixture for ${key(status, context)}`);
  const before = await footprint(cell);

  expect(await run(transition, cell.itemId)).toEqual({
    state: { formError: expected },
  });
  expect(await footprint(cell)).toEqual(before);
  expect(refresh).not.toHaveBeenCalled();
  expect(setFlash).not.toHaveBeenCalled();
  expect(redirect).not.toHaveBeenCalled();
}

async function expectAccepted(
  transition: Transition,
  status: ItemStatus,
  context: Context,
) {
  // A fresh fixture, so nothing an earlier cell did can show through.
  const cell = await fixture(status, context);
  const before = await footprint(cell);
  const photoKey = before.item?.photoKey;
  expect(photoKey).toBeTruthy();

  const result = await run(transition, cell.itemId);
  const after = await footprint(cell, photoKey);

  if (transition === "deleteItem") {
    expect(result).toEqual({ redirectedTo: "/my/items" });
    expect(setFlash).toHaveBeenCalledExactlyOnceWith("itemDeleted");
    expect(refresh).not.toHaveBeenCalled();
    expect(after.item).toBeNull();
  } else {
    expect(result).toEqual({ state: { flash: SUCCESS_FLASH[transition] } });
    expect(refresh).toHaveBeenCalledOnce();
    expect(setFlash).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(after.item?.status).toBe(TARGET[transition]);
  }

  if (transition === "retireOwnItem") {
    expect(after.item).toMatchObject({
      photoKey: null,
      photoUrl: null,
      photoWidth: null,
      photoHeight: null,
      photoBytes: null,
    });
  }
  if (transition === "retireOwnItem" || transition === "deleteItem") {
    // Queued in the transaction, removed after commit.
    expect(after.queue).toEqual([]);
  }

  if (
    context === "requested" &&
    (transition === "hideItem" || transition === "retireOwnItem")
  ) {
    expect(after.loan).toMatchObject({
      status: "declined",
      endedBy: "system",
      systemReason: SWEEP[transition],
      borrowerSeenAt: FIXTURE_INSTANT,
    });
    expect(after.loan?.changedAt.getTime()).toBeGreaterThan(
      FIXTURE_INSTANT.getTime(),
    );
    expect(after.loan?.ownerSeenAt).toEqual(after.loan?.changedAt);
  } else {
    expect(after.loan).toEqual(before.loan);
  }
}

describe.each(TRANSITIONS)("%s", (transition) => {
  const cells = STATUSES.flatMap((status) =>
    CONTEXTS.map((context) => ({ status, context })),
  );

  test.each(cells)(
    "on a $status item, loan context $context",
    async ({ status, context }) => {
      const expected = outcome(transition, status, context);
      const cell = shared.get(key(status, context));
      if (!cell) throw new Error(`no fixture for ${key(status, context)}`);

      const dto = await getItemForEdit(parties.owner.id, cell.itemId, today);
      if (!dto) throw new Error(`the owner can't read ${key(status, context)}`);
      expect(offered(dto).includes(transition)).toBe(
        expected === "accepted" && offeredWhenAccepted(transition, context),
      );

      if (expected === "accepted") {
        await expectAccepted(transition, status, context);
      } else {
        await expectRefused(transition, status, context, expected);
      }
    },
  );
});

test("the zero-loan asymmetry: Delete is offered, Retire is not, both are accepted", async () => {
  for (const status of ["hidden", "listed"] as const) {
    const cell = shared.get(key(status, "none"));
    if (!cell) throw new Error(`no fixture for ${key(status, "none")}`);
    const dto = await getItemForEdit(parties.owner.id, cell.itemId, today);
    if (!dto) throw new Error(`the owner can't read ${key(status, "none")}`);
    expect(offered(dto)).toContain("deleteItem");
    expect(offered(dto)).not.toContain("retireOwnItem");
    expect(outcome("retireOwnItem", status, "none")).toBe("accepted");
    expect(outcome("deleteItem", status, "none")).toBe("accepted");
  }
});
