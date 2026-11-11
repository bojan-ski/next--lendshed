import "server-only";
import { db } from "@/db";
import { fromDbDate } from "@/data/db-dates";
import {
  blockingLoanWhere,
  occupyingLoanWhere,
  openLoanWhere,
} from "@/data/loan-scopes";
import { personName, toPhotoDTO } from "@/data/mappers";
import type { Prisma } from "@/generated/prisma/client";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { ITEM_CAP } from "@/lib/schemas/items";
import type { ItemEditDTO, OwnItemRowDTO, OwnItemRowsDTO } from "@/types/item";

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
