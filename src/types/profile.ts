import type { ItemCardDTO } from "@/types/item";

export type MemberProfileDTO = {
  id: string;
  displayName: string;
  area: string | null;
  items: ItemCardDTO[];
};
