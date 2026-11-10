import type { FlashKey } from "@/strings";
import type { CreatedLinkDTO } from "@/types/links";

export type InvitationRowDTO = {
  id: string;
  note: string | null;
  expiresAt: string;
  createdByName: string;
};

export type InvitationFormState = {
  fieldErrors?: Partial<Record<"note", string[]>>;
  formError?: "unexpected";
  created?: CreatedLinkDTO;
};

export type RevokeInvitationState = {
  flash?: FlashKey;
  formError?: "stale" | "unexpected";
};
