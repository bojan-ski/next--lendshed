import type { LoanStatus } from "@/generated/prisma/enums";
import type { PhotoDTO } from "@/types/item";

export type { LoanStatus };

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
