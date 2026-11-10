export type LoanStatus =
  | "requested"
  | "approved"
  | "out"
  | "returned"
  | "declined"
  | "cancelled"
  | "expired"
  | "lapsed";

export type EffectiveLoanStatus = LoanStatus | "overdue";

export type LoanCardDTO = {
  id: string;
  side: "borrowing" | "lending";
  item: {
    id: string;
    title: string;
    photo: { url: string; width: number; height: number } | null;
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
