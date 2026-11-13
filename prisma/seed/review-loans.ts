import type { LoanStatus, PrismaClient } from "@/generated/prisma/client";
import { addDays, communityToday } from "@/lib/dates/dates";
import { SEED_EMAIL_DOMAIN } from "./people";

export type ReviewLoanKind =
  | "request"
  | "approved-today"
  | "approved-later"
  | "out-later"
  | "out-today"
  | "overdue"
  | "returned"
  | "expired"
  | "lapsed";

export type ReviewLoan = {
  kind: ReviewLoanKind;
  ownerEmail: string;
  title: string;
  borrowerEmail: string;
  status: LoanStatus;
  startOffset: number;
  endOffset: number;
};

const person = (local: string) => `${local}@${SEED_EMAIL_DOMAIN}`;

// The loan states ui-reviewer can't reach through the app in one day. No two
// approved/out ranges overlap on one item, so the exclusion constraint never
// fires: `lapsed` shares Extension ladder with `approved-later`, days apart.
export const REVIEW_LOANS: readonly ReviewLoan[] = [
  {
    kind: "request",
    ownerEmail: person("ana"),
    title: "Stand mixer",
    borrowerEmail: person("tom"),
    status: "requested",
    startOffset: 1,
    endOffset: 3,
  },
  {
    kind: "approved-today",
    ownerEmail: person("marko"),
    title: "Hedge trimmer",
    borrowerEmail: person("ana"),
    status: "approved",
    startOffset: -1,
    endOffset: 1,
  },
  {
    kind: "approved-later",
    ownerEmail: person("ruth"),
    title: "Extension ladder",
    borrowerEmail: person("lena"),
    status: "approved",
    startOffset: 7,
    endOffset: 9,
  },
  {
    kind: "out-later",
    ownerEmail: person("tom"),
    title: "Two-person tent",
    borrowerEmail: person("dev"),
    status: "out",
    startOffset: -2,
    endOffset: 2,
  },
  {
    kind: "out-today",
    ownerEmail: person("dev"),
    title: "Cordless drill",
    borrowerEmail: person("sara"),
    status: "out",
    startOffset: -2,
    endOffset: 0,
  },
  {
    kind: "overdue",
    ownerEmail: person("lena"),
    title: "Baby carrier",
    borrowerEmail: person("marko"),
    status: "out",
    startOffset: -6,
    endOffset: -3,
  },
  {
    kind: "returned",
    ownerEmail: person("sara"),
    title: "Pasta machine",
    borrowerEmail: person("ruth"),
    status: "returned",
    startOffset: -20,
    endOffset: -18,
  },
  {
    kind: "expired",
    ownerEmail: person("ruth"),
    title: "Travel cot",
    borrowerEmail: person("sara"),
    status: "requested",
    startOffset: -2,
    endOffset: -1,
  },
  {
    kind: "lapsed",
    ownerEmail: person("ruth"),
    title: "Extension ladder",
    borrowerEmail: person("dev"),
    status: "approved",
    startOffset: -5,
    endOffset: -2,
  },
];

export const reviewLoanMarker = (kind: ReviewLoanKind) => `review-loan:${kind}`;

// The @db.Date value toDbDate builds; that module is server-only.
const dbDate = (date: string) => new Date(`${date}T00:00:00.000Z`);

async function activeWithContact(client: PrismaClient, email: string) {
  return client.user.findUnique({
    where: { email },
    select: { id: true, status: true, contactDetails: true },
  });
}

// Re-dates and re-statuses each marked loan for `today`, or creates it. Never
// deletes, and never touches a loan without its marker.
export async function ensureReviewLoans(
  client: PrismaClient,
  entries: readonly ReviewLoan[],
  today: string,
): Promise<{ created: number; updated: number }> {
  let created = 0;
  for (const entry of entries) {
    const label = `Review loan ${entry.kind} on "${entry.title}"`;
    const owner = await activeWithContact(client, entry.ownerEmail);
    if (!owner) {
      throw new Error(
        `${label}: no member ${entry.ownerEmail}. Seed people first.`,
      );
    }
    if (owner.status !== "active" || !owner.contactDetails) {
      throw new Error(
        `${label}: the owner must be active with contact details.`,
      );
    }
    const borrower = await activeWithContact(client, entry.borrowerEmail);
    if (
      !borrower ||
      borrower.id === owner.id ||
      borrower.status !== "active" ||
      !borrower.contactDetails
    ) {
      throw new Error(
        `${label}: the borrower must be another active member with contact details.`,
      );
    }
    const item = await client.item.findFirst({
      where: { ownerId: owner.id, title: entry.title },
      select: { id: true, status: true },
    });
    if (!item) {
      throw new Error(`${label}: no such item. Seed items first.`);
    }
    if (item.status !== "listed") {
      throw new Error(`${label}: the item is not listed. Seed photos first.`);
    }

    const startDate = dbDate(addDays(today, entry.startOffset));
    const endDate = addDays(today, entry.endOffset);
    const requestMessage = reviewLoanMarker(entry.kind);
    // The exclusion constraint would refuse it anyway; say which item.
    if (entry.status === "approved" || entry.status === "out") {
      const clash = await client.loan.findFirst({
        where: {
          itemId: item.id,
          status: { in: ["approved", "out"] },
          // A bare NOT would skip rows without a message (NULL).
          OR: [
            { requestMessage: null },
            { requestMessage: { not: requestMessage } },
          ],
          startDate: { lte: dbDate(endDate) },
          endDate: { gte: startDate },
        },
        select: { id: true },
      });
      if (clash) {
        throw new Error(
          `${label}: its dates overlap another approved or out loan on the item.`,
        );
      }
    }

    const returned = entry.status === "returned";
    const data = {
      borrowerId: borrower.id,
      status: entry.status,
      startDate,
      endDate: dbDate(endDate),
      returnedOn: returned ? dbDate(endDate) : null,
      returnedAsLent: returned ? ("yes" as const) : null,
      endedBy: null,
      systemReason: null,
      statusReason: null,
      closedById: null,
    };
    const existing = await client.loan.findFirst({
      where: { itemId: item.id, requestMessage },
      select: { id: true },
    });
    if (existing) {
      await client.loan.update({ where: { id: existing.id }, data });
      continue;
    }
    await client.loan.create({
      data: { ...data, itemId: item.id, requestMessage },
    });
    created += 1;
  }
  return { created, updated: entries.length - created };
}

export async function seedReviewLoans(
  client: PrismaClient,
  today: string = communityToday(),
): Promise<void> {
  await ensureReviewLoans(client, REVIEW_LOANS, today);
}
