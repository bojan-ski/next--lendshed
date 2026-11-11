import type { FlashKey } from "@/strings";

export type CategoryDTO = {
  id: string;
  name: string;
};

export type AdminCategoryDTO = CategoryDTO & { inUse: boolean };

export type NewCategoryState = {
  fieldErrors?: Partial<Record<"name", string[]>>;
  formError?: "unexpected";
  flash?: FlashKey;
  values?: { name: string };
};

// `values` only on a fieldErrors refusal, so the field keeps the typed text.
export type RenameCategoryState = {
  fieldErrors?: Partial<Record<"name", string[]>>;
  formError?: "stale" | "unexpected";
  flash?: FlashKey;
  values?: { name: string };
};

export type DeleteCategoryState = {
  flash?: FlashKey;
  formError?: "stale" | "inUse" | "unexpected";
};
