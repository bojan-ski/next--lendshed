import type {
  ItemStatus,
  LoanActor,
  LoanStatus,
  LoanSystemReason,
  ReturnedAsLent,
} from "@/generated/prisma/enums";
import type { FlashKey } from "@/strings";
import type { PhotoDTO } from "@/types/item";

export type { LoanActor, LoanStatus, LoanSystemReason, ReturnedAsLent };

export type EffectiveLoanStatus = LoanStatus | "overdue";

export type LoanCardDTO = {
  id: string;
  side: "borrowing" | "lending";
  item: {
    id: string;
    title: string;
    photo: PhotoDTO | null;
  };
  otherPartyName: string;
  startDate: string;
  endDate: string;
  status: EffectiveLoanStatus;
  group: "needs_you" | "active" | "past";
  needsYou:
    | "review_request"
    | "hand_over"
    | "arrange_pickup"
    | "due_back"
    | "overdue"
    | null;
  changed: boolean;
};

export type LoanViewerRole = "owner" | "borrower" | "organizer";

export type LoanAction =
  | "approve"
  | "decline"
  | "cancel"
  | "hand_over"
  | "mark_returned"
  | "organizer_close";

export type LoanDetailDTO = {
  id: string;
  status: EffectiveLoanStatus;
  startDate: string;
  endDate: string;
  lengthDays: number;
  // `viewable`: /items/[id] would show the item to this viewer.
  item: {
    id: string;
    title: string;
    photo: PhotoDTO | null;
    status: ItemStatus;
    viewable: boolean;
  };
  owner: { id: string | null; displayName: string };
  borrower: { id: string | null; displayName: string };
  viewerRole: LoanViewerRole;
  requestMessage: string | null;
  statusReason: string | null;
  endedBy: LoanActor | null;
  systemReason: LoanSystemReason | null;
  returnedOn: string | null;
  returnedAsLent: ReturnedAsLent | null;
  closedByName: string | null;
  overlappingRequestCount: number;
  // The owner could hand over now but for another loan on the item still out.
  handOverBlocked: boolean;
  // The other party's, only while brief §7.4 allows it.
  contact: { name: string; details: string } | null;
  actions: LoanAction[];
};

export type RequestLoanField = "startDate" | "endDate" | "message";

// Success redirects, so there is no flash in the state.
export type RequestLoanState = {
  fieldErrors?: Partial<Record<RequestLoanField, string[]>>;
  formError?:
    | "stale"
    | "needsContactDetails"
    | "itemLimit"
    | "overallLimit"
    | "datesTaken"
    | "unexpected";
  values?: Partial<Record<RequestLoanField, string>>;
};

// One state for approve, decline and cancel; approve never returns a reason.
export type LoanDecisionState = {
  flash?: FlashKey;
  formError?: "stale" | "datesTaken" | "unexpected";
  fieldErrors?: { reason?: string[] };
  values?: { reason?: string };
};

// Which cancel the screen offered: a request, or an approved loan.
export type CancelStage = "request" | "loan";

export type HandOverState = {
  flash?: FlashKey;
  formError?: "stale" | "stillOut" | "unexpected";
};

export type MarkReturnedField = "returnedOn" | "asLent";

export type MarkReturnedState = {
  flash?: FlashKey;
  formError?: "stale" | "unexpected";
  fieldErrors?: Partial<Record<MarkReturnedField, string[]>>;
  values?: Partial<Record<MarkReturnedField, string>>;
};

export type ApproveOutcome = "approved" | "stale" | "datesTaken";
export type DeclineOutcome = "declined" | "stale";
export type CancelOutcome = "cancelled" | "stale";
export type HandOverOutcome = "handedOver" | "stale" | "stillOut";
export type MarkBackOutcome = "returned" | "stale" | "beforeStart";

export type InsertLoanRequestOutcome =
  | { kind: "created"; id: string }
  | { kind: "stale" }
  | { kind: "needsContactDetails" }
  | { kind: "itemLimit" }
  | { kind: "overallLimit" }
  | { kind: "tooLong"; maxLoanDays: number }
  | { kind: "datesTaken" };
