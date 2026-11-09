export type ItemCardDTO = {
  id: string;
  title: string;
  categoryName: string;
  ownerName: string;
  ownerArea: string | null;
  photo: { url: string; width: number; height: number } | null;
  freeToday: boolean;
};
