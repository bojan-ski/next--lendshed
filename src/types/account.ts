import type { FlashKey } from "@/strings";

export type AccountDTO = {
  displayName: string;
  area: string | null;
  contactDetails: string | null;
  email: string;
  contactDetailsLocked: boolean;
};

export type ProfileFormState = {
  fieldErrors?: Partial<Record<"name" | "area", string[]>>;
  formError?: "unexpected";
  flash?: FlashKey;
  name?: string;
  area?: string;
};

export type ContactDetailsFormState = {
  fieldErrors?: Partial<Record<"contactDetails", string[]>>;
  formError?: "contactDetailsLocked" | "unexpected";
  flash?: FlashKey;
  contactDetails?: string;
};

export type ChangePasswordState = {
  fieldErrors?: Partial<Record<"currentPassword" | "newPassword", string[]>>;
  formError?: "tooManyAttempts" | "unexpected";
  flash?: FlashKey;
};

export type ChangePasswordError =
  "invalidCurrentPassword" | "tooManyAttempts" | "unexpected";
