import type { MemberStatus, Role } from "@/generated/prisma/enums";
import type { FlashKey } from "@/strings";
import type { CreatedLinkDTO } from "@/types/links";
import type { EffectiveLoanStatus } from "@/types/loan";

export type AdminMemberRowDTO = {
  id: string;
  displayName: string;
  initials: string;
  role: Role;
  status: MemberStatus;
  openLoanCount: number;
};

export type AdminMemberOpenLoan = {
  id: string;
  itemTitle: string;
  side: "lent" | "borrowed";
  otherPartyName: string;
  status: EffectiveLoanStatus;
  endDate: string;
};

export type AdminMemberDetailDTO = AdminMemberRowDTO & {
  area: string | null;
  memberSince: string;
  openLoans: AdminMemberOpenLoan[];
  isSelf: boolean;
  isLastActiveOrganizer: boolean;
  canDelete: boolean;
};

export type RoleChangeOutcome = "changed" | "stale" | "lastOrganizer";

export type RoleChangeState = {
  flash?: FlashKey;
  formError?: "self" | "stale" | "lastOrganizer" | "unexpected";
};

export type SuspendOutcome = "suspended" | "stale" | "lastOrganizer";

export type ReinstateOutcome = "reinstated" | "stale";

export type MemberStatusState = {
  flash?: FlashKey;
  formError?: "self" | "stale" | "lastOrganizer" | "unexpected";
};

export type ResetLinkState = {
  created?: CreatedLinkDTO;
  formError?: "self" | "stale" | "unexpected";
};

export type DeleteMemberOutcome =
  "deleted" | "stale" | "itemOut" | "holdingItem";

export type DeleteMemberState = {
  formError?: "self" | "stale" | "itemOut" | "holdingItem" | "unexpected";
};

export type ResetGrantOutcome =
  | { kind: "created"; displayName: string }
  | { kind: "memberGone" }
  | { kind: "actorGone" };
