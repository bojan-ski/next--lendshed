import type { ItemCondition, ItemStatus } from "@/generated/prisma/enums";
import type { FlashKey } from "@/strings";

export type PhotoDTO = { url: string; width: number; height: number };

export type ItemCardDTO = {
  id: string;
  title: string;
  // The id only colours the category chip and placeholder (hueFor).
  categoryId: string;
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
  // Why another member's item can't be requested; null for an own item.
  requestBlock: "contact_details" | "item_limit" | "overall_limit" | null;
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

// The saved values ItemDetailsForm starts from; its props reach the browser.
export type ItemDetailsDefaults = Pick<ItemEditDTO, "id" | ItemDetailsField>;

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

// Success redirects, so there is no flash in the state.
export type OrganizerRetireState = {
  formError?: "stale" | "stillOut" | "unexpected";
  fieldErrors?: { note?: string[] };
  values?: { note?: string };
};

export type OrganizerRetireOutcome = "retired" | "stale" | "stillOut";

export type InsertItemOutcome =
  | { kind: "created"; id: string }
  | { kind: "capReached" }
  | { kind: "categoryMissing" };
