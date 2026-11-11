import type { ItemCondition, ItemStatus } from "@/generated/prisma/enums";

export type PhotoDTO = { url: string; width: number; height: number };

export type ItemCardDTO = {
  id: string;
  title: string;
  categoryName: string;
  ownerName: string;
  ownerArea: string | null;
  photo: PhotoDTO | null;
  freeToday: boolean;
};

export type OwnItemNowKind =
  | "requested_by"
  | "with"
  | "back_today"
  | "overdue"
  | "hidden"
  | "retired"
  | "idle";

export type OwnItemRowDTO = {
  id: string;
  title: string;
  status: ItemStatus;
  photo: PhotoDTO | null;
  now: { kind: OwnItemNowKind; personName: string | null };
};

export type OwnItemRowsDTO = {
  rows: OwnItemRowDTO[];
  activeCount: number;
  cap: 30;
};

export type ItemEditDTO = {
  id: string;
  title: string;
  description: string;
  categoryId: string;
  condition: ItemCondition;
  maxLoanDays: number;
  pickupNotes: string | null;
  status: ItemStatus;
  photo: PhotoDTO | null;
  retiredNote: string | null;
  hasAnyLoan: boolean;
  hasBlockingLoan: boolean;
  ownerHasContactDetails: boolean;
};
