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
};

export type RoleChangeOutcome = "changed" | "stale" | "lastOrganizer";

export type RoleChangeState = {
  flash?: FlashKey;
  formError?: "self" | "stale" | "lastOrganizer" | "unexpected";
};

export type ResetLinkState = {
  created?: CreatedLinkDTO;
  formError?: "self" | "stale" | "unexpected";
};

export type ResetGrantOutcome =
  { kind: "created"; displayName: string } | { kind: "memberGone" };
