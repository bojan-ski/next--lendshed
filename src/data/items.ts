import "server-only";
import { db } from "@/db";
import { deletePendingBlobs, queueBlobDeletion } from "@/data/blob-deletions";
import { fromDbDate } from "@/data/db-dates";
import { isCategoryReferenced, isItemReferencedByLoan } from "@/data/db-errors";
import {
  blockingLoanWhere,
  occupyingLoanWhere,
  openLoanWhere,
} from "@/data/loan-scopes";
import { personName, toPhotoDTO } from "@/data/mappers";
import type { Prisma } from "@/generated/prisma/client";
import type { ItemStatus, LoanSystemReason } from "@/generated/prisma/enums";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { ITEM_CAP, type ItemDetailsInput } from "@/lib/schemas/items";
import type {
  InsertItemOutcome,
  ItemEditDTO,
  OwnItemRowDTO,
  OwnItemRowsDTO,
} from "@/types/item";

const photoSelect = {
  photoUrl: true,
  photoWidth: true,
  photoHeight: true,
} satisfies Prisma.ItemSelect;

// The loans the Now line can name: anything out, and open requests.
function ownItemSelect(today: string) {
  return {
    id: true,
    title: true,
    status: true,
    ...photoSelect,
    loans: {
      where: { OR: [occupyingLoanWhere(), openLoanWhere(today)] },
      orderBy: [{ startDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        status: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        borrower: { select: { name: true } },
      },
    },
  } satisfies Prisma.ItemSelect;
}

type OwnItemRow = Prisma.ItemGetPayload<{
  select: ReturnType<typeof ownItemSelect>;
}>;

// First match wins: retired, then an out loan (even on a hidden item), then
// hidden, then the earliest open request.
export function toOwnItemRowDTO(row: OwnItemRow, today: string): OwnItemRowDTO {
  const loans = row.loans.map((loan) => {
    const startDate = fromDbDate(loan.startDate);
    const endDate = fromDbDate(loan.endDate);
    return {
      effective: effectiveStatus(
        { status: loan.status, startDate, endDate },
        today,
      ),
      endDate,
      createdAt: loan.createdAt.getTime(),
      personName: personName(loan.borrower),
    };
  });
  const occupying = loans.find(
    (loan) => loan.effective === "out" || loan.effective === "overdue",
  );
  const open = loans
    .filter((loan) => loan.effective === "requested")
    .sort((a, b) => a.createdAt - b.createdAt)[0];

  const now = ((): OwnItemRowDTO["now"] => {
    if (row.status === "retired") return { kind: "retired", personName: null };
    if (occupying) {
      const kind =
        occupying.endDate < today
          ? "overdue"
          : occupying.endDate === today
            ? "back_today"
            : "with";
      return { kind, personName: occupying.personName };
    }
    if (row.status === "hidden") return { kind: "hidden", personName: null };
    if (open) return { kind: "requested_by", personName: open.personName };
    return { kind: "idle", personName: null };
  })();

  return {
    id: row.id,
    title: row.title,
    status: row.status,
    photo: toPhotoDTO(row),
    now,
  };
}

export async function getOwnItems(
  ownerId: string,
  today: string,
): Promise<OwnItemRowsDTO> {
  const select = ownItemSelect(today);
  const [active, retired] = await Promise.all([
    db.item.findMany({
      where: { ownerId, status: { not: "retired" } },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      select,
    }),
    db.item.findMany({
      where: { ownerId, status: "retired" },
      orderBy: [{ retiredAt: "desc" }, { id: "asc" }],
      select,
    }),
  ]);
  return {
    rows: [...active, ...retired].map((row) => toOwnItemRowDTO(row, today)),
    activeCount: active.length,
    cap: ITEM_CAP,
  };
}

function itemEditSelect(today: string) {
  return {
    id: true,
    title: true,
    description: true,
    categoryId: true,
    condition: true,
    maxLoanDays: true,
    pickupNotes: true,
    status: true,
    retiredNote: true,
    ...photoSelect,
    owner: { select: { contactDetails: true } },
    loans: { where: blockingLoanWhere(today), take: 1, select: { id: true } },
    _count: { select: { loans: true } },
  } satisfies Prisma.ItemSelect;
}

type ItemEditRow = Prisma.ItemGetPayload<{
  select: ReturnType<typeof itemEditSelect>;
}>;

export function toItemEditDTO(
  row: ItemEditRow,
  flags: Pick<
    ItemEditDTO,
    "hasAnyLoan" | "hasBlockingLoan" | "ownerHasContactDetails"
  >,
): ItemEditDTO {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    categoryId: row.categoryId,
    condition: row.condition,
    maxLoanDays: row.maxLoanDays,
    pickupNotes: row.pickupNotes,
    status: row.status,
    photo: toPhotoDTO(row),
    retiredNote: row.retiredNote,
    ...flags,
  };
}

// Null for an unknown id or someone else's item: the page renders not-found.
export async function getItemForEdit(
  ownerId: string,
  itemId: string,
  today: string,
): Promise<ItemEditDTO | null> {
  const row = await db.item.findFirst({
    where: { id: itemId, ownerId },
    select: itemEditSelect(today),
  });
  if (!row) return null;
  return toItemEditDTO(row, {
    hasAnyLoan: row._count.loans > 0,
    hasBlockingLoan: row.loans.length > 0,
    ownerHasContactDetails: row.owner?.contactDetails != null,
  });
}

const activeOwnItemsWhere = (ownerId: string) =>
  ({ ownerId, status: { not: "retired" } }) satisfies Prisma.ItemWhereInput;

export async function countActiveOwnItems(ownerId: string): Promise<number> {
  return db.item.count({ where: activeOwnItemsWhere(ownerId) });
}

function detailsData(details: ItemDetailsInput) {
  return {
    title: details.title,
    description: details.description,
    categoryId: details.categoryId,
    condition: details.condition,
    maxLoanDays: details.maxLoanDays,
    pickupNotes: details.pickupNotes,
  } satisfies Prisma.ItemUncheckedUpdateInput;
}

// Two creates racing at 29 may both pass (31): the margins absorb it, so no lock.
export async function insertItem(
  ownerId: string,
  details: ItemDetailsInput,
): Promise<InsertItemOutcome> {
  try {
    return await db.$transaction(async (tx) => {
      const active = await tx.item.count({
        where: activeOwnItemsWhere(ownerId),
      });
      if (active >= ITEM_CAP) return { kind: "capReached" } as const;
      const { id } = await tx.item.create({
        data: { ...detailsData(details), ownerId, status: "hidden" },
        select: { id: true },
      });
      return { kind: "created", id } as const;
    });
  } catch (error) {
    if (isCategoryReferenced(error)) return { kind: "categoryMissing" };
    throw error;
  }
}

type LockedItem = {
  status: ItemStatus;
  photoUrl: string | null;
  photoKey: string | null;
  photoBytes: number | null;
};

// The item row, locked before anything is read: loan writers (13–15) and the
// photo attach lock the same row, so they serialise with hide, retire and
// delete. Null when the viewer doesn't own it, so an unknown id and someone
// else's look the same.
export async function lockOwnItem(
  tx: Prisma.TransactionClient,
  ownerId: string,
  itemId: string,
): Promise<LockedItem | null> {
  const [row] = await tx.$queryRaw<(LockedItem & { ownerId: string | null })[]>`
    SELECT "ownerId", status, "photoUrl", "photoKey", "photoBytes"
    FROM item WHERE id = ${itemId} FOR UPDATE`;
  if (!row || row.ownerId !== ownerId) return null;
  return {
    status: row.status,
    photoUrl: row.photoUrl,
    photoKey: row.photoKey,
    photoBytes: row.photoBytes,
  };
}

export const isEditable = (item: LockedItem | null): item is LockedItem =>
  item?.status === "hidden" || item?.status === "listed";

// The stored file a retire or delete stops referencing, queued in its
// transaction (the outbox) and deleted after commit.
async function queueItemPhoto(
  tx: Prisma.TransactionClient,
  item: LockedItem,
): Promise<string | null> {
  if (item.photoKey === null) return null;
  await queueBlobDeletion(tx, {
    storageKey: item.photoKey,
    bytes: item.photoBytes ?? 0,
  });
  return item.photoKey;
}

const NO_PHOTO = {
  photoKey: null,
  photoUrl: null,
  photoWidth: null,
  photoHeight: null,
  photoBytes: null,
} satisfies Prisma.ItemUpdateInput;

// Only effective requests: expired ones are left as they are, and approved or
// out loans carry on. The borrower's seen-at stays, so only they see the dot.
async function declineOpenRequests(
  tx: Prisma.TransactionClient,
  itemId: string,
  today: string,
  systemReason: Extract<LoanSystemReason, "item_hidden" | "item_retired">,
): Promise<void> {
  const now = new Date();
  await tx.loan.updateMany({
    where: { AND: [{ itemId }, openLoanWhere(today)] },
    data: {
      status: "declined",
      endedBy: "system",
      systemReason,
      changedAt: now,
      ownerSeenAt: now,
    },
  });
}

export async function updateOwnItem(
  ownerId: string,
  itemId: string,
  details: ItemDetailsInput,
): Promise<"saved" | "stale" | "categoryMissing"> {
  try {
    return await db.$transaction(async (tx) => {
      if (!isEditable(await lockOwnItem(tx, ownerId, itemId))) return "stale";
      await tx.item.update({
        where: { id: itemId },
        data: detailsData(details),
      });
      return "saved";
    });
  } catch (error) {
    if (isCategoryReferenced(error)) return "categoryMissing";
    throw error;
  }
}

// Own user row first (FOR SHARE), then the item: a contact-details clear locks
// the same row FOR UPDATE, so it runs strictly before or after this.
export async function listOwnItem(
  ownerId: string,
  itemId: string,
): Promise<"listed" | "stale" | "needsPhoto" | "needsContactDetails"> {
  return db.$transaction(async (tx) => {
    const [owner] = await tx.$queryRaw<{ contactDetails: string | null }[]>`
      SELECT "contactDetails" FROM "user" WHERE id = ${ownerId} FOR SHARE`;
    const item = await lockOwnItem(tx, ownerId, itemId);
    if (!owner || item?.status !== "hidden") return "stale";
    if (item.photoUrl === null) return "needsPhoto";
    if (owner.contactDetails === null) return "needsContactDetails";
    await tx.item.update({
      where: { id: itemId },
      data: { status: "listed", listedAt: new Date() },
    });
    return "listed";
  });
}

export async function hideOwnItem(
  ownerId: string,
  itemId: string,
  today: string,
): Promise<"hidden" | "stale"> {
  return db.$transaction(async (tx) => {
    const item = await lockOwnItem(tx, ownerId, itemId);
    if (item?.status !== "listed") return "stale";
    await tx.item.update({
      where: { id: itemId },
      data: { status: "hidden" },
    });
    await declineOpenRequests(tx, itemId, today, "item_hidden");
    return "hidden";
  });
}

// A lapsed approval doesn't block (OQ-35 leaves the owner's rule as it is).
export async function retireItemByOwner(
  ownerId: string,
  itemId: string,
  today: string,
): Promise<"retired" | "stale" | "blocked"> {
  const outcome = await db.$transaction(async (tx) => {
    const item = await lockOwnItem(tx, ownerId, itemId);
    if (!isEditable(item)) return { result: "stale" as const };
    const blocking = await tx.loan.count({
      where: { AND: [{ itemId }, blockingLoanWhere(today)] },
      take: 1,
    });
    if (blocking > 0) return { result: "blocked" as const };
    const photoKey = await queueItemPhoto(tx, item);
    await tx.item.update({
      where: { id: itemId },
      data: { status: "retired", retiredAt: new Date(), ...NO_PHOTO },
    });
    await declineOpenRequests(tx, itemId, today, "item_retired");
    return { result: "retired" as const, photoKey };
  });
  if (outcome.result === "retired" && outcome.photoKey) {
    await deletePendingBlobs([outcome.photoKey]);
  }
  return outcome.result;
}

// Any loan row at all, whatever its status; the Restrict FK backs the count.
export async function deleteOwnItem(
  ownerId: string,
  itemId: string,
): Promise<"deleted" | "stale" | "hasLoans"> {
  let outcome;
  try {
    outcome = await db.$transaction(async (tx) => {
      const item = await lockOwnItem(tx, ownerId, itemId);
      if (!isEditable(item)) return { result: "stale" as const };
      if ((await tx.loan.count({ where: { itemId }, take: 1 })) > 0) {
        return { result: "hasLoans" as const };
      }
      // Queued first: the FK backstop's rollback takes the queue row with it.
      const photoKey = await queueItemPhoto(tx, item);
      await tx.item.delete({ where: { id: itemId } });
      return { result: "deleted" as const, photoKey };
    });
  } catch (error) {
    if (isItemReferencedByLoan(error)) return "hasLoans";
    throw error;
  }
  if (outcome.result === "deleted" && outcome.photoKey) {
    await deletePendingBlobs([outcome.photoKey]);
  }
  return outcome.result;
}
