import "server-only";
import { db } from "@/db";
import { fromDbDate } from "@/data/db-dates";
import {
  blockingLoanWhere,
  notFreeTodayLoanWhere,
  openLoanWhere,
} from "@/data/loan-scopes";
import { personName, toPhotoDTO } from "@/data/mappers";
import { containsText } from "@/data/text-search";
import type { Prisma } from "@/generated/prisma/client";
import type { ItemStatus, MemberStatus } from "@/generated/prisma/enums";
import { effectiveStatus } from "@/lib/dates/effective-status";
import { REQUEST_LIMITS } from "@/lib/loans/limits";
import { BROWSE_PAGE_SIZE, type BrowseQuery } from "@/lib/schemas/browse";
import type {
  BookedRangeDTO,
  BrowsePageDTO,
  ItemCardDTO,
  ItemDetailDTO,
} from "@/types/item";
import type { MemberProfileDTO } from "@/types/profile";
import type { ViewerDTO } from "@/types/viewer";

// The one visibility scope: Listed, and the owner exists and is active.
// Suspension never changes item states (OQ-23); this scope alone hides them.
function visibleItemWhere(): Prisma.ItemWhereInput {
  return { status: "listed", owner: { is: { status: "active" } } };
}

// The same scope on one loaded row (the loan page's item link). Change both
// together: browse.test.ts checks them against each other.
export function isVisibleItem(item: {
  status: ItemStatus;
  owner: { status: MemberStatus } | null;
}): boolean {
  return item.status === "listed" && item.owner?.status === "active";
}

const newestFirst = [
  { listedAt: { sort: "desc", nulls: "last" } },
  { id: "desc" },
] satisfies Prisma.ItemOrderByWithRelationInput[];

function cardSelect(today: string) {
  return {
    id: true,
    title: true,
    status: true,
    photoUrl: true,
    photoWidth: true,
    photoHeight: true,
    category: { select: { id: true, name: true } },
    owner: { select: { name: true, area: true } },
    _count: { select: { loans: { where: notFreeTodayLoanWhere(today) } } },
  } satisfies Prisma.ItemSelect;
}

type CardRow = Prisma.ItemGetPayload<{
  select: ReturnType<typeof cardSelect>;
}>;

function toItemCardDTO(row: CardRow): ItemCardDTO {
  return {
    id: row.id,
    title: row.title,
    categoryId: row.category.id,
    categoryName: row.category.name,
    ownerName: personName(row.owner),
    ownerArea: row.owner?.area ?? null,
    photo: toPhotoDTO(row),
    freeToday: row.status === "listed" && row._count.loans === 0,
  };
}

export async function getBrowseItems(
  viewerId: string,
  query: BrowseQuery,
  today: string,
): Promise<BrowsePageDTO> {
  const rows = await db.item.findMany({
    where: {
      AND: [
        visibleItemWhere(),
        { ownerId: { not: viewerId } },
        query.category ? { categoryId: query.category } : {},
        query.q
          ? {
              OR: [
                { title: containsText(query.q) },
                { description: containsText(query.q) },
              ],
            }
          : {},
      ],
    },
    orderBy: newestFirst,
    skip: (query.page - 1) * BROWSE_PAGE_SIZE,
    take: BROWSE_PAGE_SIZE + 1,
    select: cardSelect(today),
  });
  return {
    items: rows.slice(0, BROWSE_PAGE_SIZE).map(toItemCardDTO),
    page: query.page,
    hasPrevious: query.page > 1,
    hasNext: rows.length > BROWSE_PAGE_SIZE,
  };
}

function detailSelect(today: string) {
  return {
    ...cardSelect(today),
    description: true,
    condition: true,
    maxLoanDays: true,
    pickupNotes: true,
    ownerId: true,
    loans: {
      where: blockingLoanWhere(today),
      orderBy: [{ startDate: "asc" }, { id: "asc" }],
      select: { status: true, startDate: true, endDate: true },
    },
  } satisfies Prisma.ItemSelect;
}

type DetailRow = Prisma.ItemGetPayload<{
  select: ReturnType<typeof detailSelect>;
}>;

// Overdue (still out) rows first; the rest keep the query's date order.
function toBookedRanges(row: DetailRow, today: string): BookedRangeDTO[] {
  const ranges = row.loans.map((loan) => {
    const startDate = fromDbDate(loan.startDate);
    const endDate = fromDbDate(loan.endDate);
    const status = effectiveStatus(
      { status: loan.status, startDate, endDate },
      today,
    );
    return { startDate, endDate, stillOut: status === "overdue" };
  });
  return [
    ...ranges.filter((range) => range.stillOut),
    ...ranges.filter((range) => !range.stillOut),
  ];
}

// First match wins; requestLoan re-checks all three in its transaction. A
// missing viewer row can't request either, so it reads as no details.
function toRequestBlock(
  borrower: {
    contactDetails: string | null;
    _count: { loansBorrowed: number };
    loansBorrowed: { id: string }[];
  } | null,
): ItemDetailDTO["requestBlock"] {
  if (!borrower || borrower.contactDetails === null) return "contact_details";
  if (borrower.loansBorrowed.length >= REQUEST_LIMITS.perItem) {
    return "item_limit";
  }
  if (borrower._count.loansBorrowed >= REQUEST_LIMITS.overall) {
    return "overall_limit";
  }
  return null;
}

// A visible item, or any item the viewer owns; null otherwise. Organizers get
// no extra visibility here, only the retire on items that aren't theirs.
export async function getItemForViewer(
  viewer: Pick<ViewerDTO, "id" | "role">,
  itemId: string,
  today: string,
): Promise<ItemDetailDTO | null> {
  const [row, borrower] = await Promise.all([
    db.item.findFirst({
      where: {
        id: itemId,
        OR: [{ ownerId: viewer.id }, visibleItemWhere()],
      },
      select: detailSelect(today),
    }),
    db.user.findUnique({
      where: { id: viewer.id },
      select: {
        contactDetails: true,
        _count: { select: { loansBorrowed: { where: openLoanWhere(today) } } },
        loansBorrowed: {
          where: { AND: [{ itemId }, openLoanWhere(today)] },
          take: REQUEST_LIMITS.perItem,
          select: { id: true },
        },
      },
    }),
  ]);
  if (!row || !row.owner || row.ownerId === null) return null;

  const isOwn = row.ownerId === viewer.id;
  const requestBlock = isOwn ? null : toRequestBlock(borrower);

  return {
    ...toItemCardDTO(row),
    description: row.description,
    condition: row.condition,
    maxLoanDays: row.maxLoanDays,
    pickupNotes: row.pickupNotes,
    status: row.status,
    owner: {
      id: row.ownerId,
      displayName: row.owner.name,
      area: row.owner.area,
    },
    bookedRanges: toBookedRanges(row, today),
    isOwn,
    requestBlock,
    viewerCanRequest: !isOwn && requestBlock === null,
    viewerCanRetireAsOrganizer: viewer.role === "organizer" && !isOwn,
  };
}

// Every viewer sees the member's Listed items, the member included (spec 12
// clarify); an active member's items need no owner check beyond the member's.
export async function getMemberProfile(
  memberId: string,
  today: string,
): Promise<MemberProfileDTO | null> {
  const member = await db.user.findFirst({
    where: { id: memberId, status: "active" },
    select: {
      id: true,
      name: true,
      area: true,
      itemsOwned: {
        where: { status: "listed" },
        orderBy: newestFirst,
        select: cardSelect(today),
      },
    },
  });
  if (!member) return null;
  return {
    id: member.id,
    displayName: member.name,
    area: member.area,
    items: member.itemsOwned.map(toItemCardDTO),
  };
}
