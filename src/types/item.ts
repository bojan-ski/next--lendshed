import type { ItemCondition, ItemStatus } from "@/generated/prisma/enums";
import type { FlashKey } from "@/strings";

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

export type BrowsePageDTO = {
  items: ItemCardDTO[];
  page: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

// Never names who holds the item.
export type BookedRangeDTO = {
  startDate: string;
  endDate: string;
  stillOut: boolean;
};

export type ItemDetailDTO = ItemCardDTO & {
  description: string;
  condition: ItemCondition;
  maxLoanDays: number;
  pickupNotes: string | null;
  status: ItemStatus;
  owner: { id: string; displayName: string; area: string | null };
  bookedRanges: BookedRangeDTO[];
  isOwn: boolean;
  viewerCanRequest: boolean;
  viewerCanRetireAsOrganizer: boolean;
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

export type ItemDetailsField =
  | "title"
  | "description"
  | "categoryId"
  | "condition"
  | "maxLoanDays"
  | "pickupNotes";

// createItem never returns "stale"; updateItem never returns "capReached".
export type ItemDetailsFormState = {
  fieldErrors?: Partial<Record<ItemDetailsField, string[]>>;
  formError?: "capReached" | "stale" | "unexpected";
  flash?: FlashKey;
  values?: Partial<Record<ItemDetailsField, string>>;
};

export type ItemVisibilityState = {
  formError?: "stale" | "needsPhoto" | "needsContactDetails" | "unexpected";
  flash?: FlashKey;
};

export type RetireItemState = {
  formError?: "stale" | "blocked" | "unexpected";
  flash?: FlashKey;
};

// Success redirects, so there is no flash in the state.
export type DeleteItemState = {
  formError?: "stale" | "hasLoans" | "unexpected";
};

export type InsertItemOutcome =
  | { kind: "created"; id: string }
  | { kind: "capReached" }
  | { kind: "categoryMissing" };
