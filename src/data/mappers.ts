import "server-only";
import { people } from "@/strings/people";
import type { PhotoDTO } from "@/types/item";

export function toPhotoDTO(row: {
  photoUrl: string | null;
  photoWidth: number | null;
  photoHeight: number | null;
}): PhotoDTO | null {
  if (
    row.photoUrl === null ||
    row.photoWidth === null ||
    row.photoHeight === null
  ) {
    return null;
  }
  return { url: row.photoUrl, width: row.photoWidth, height: row.photoHeight };
}

// A deleted account leaves a null id behind (OQ-18).
export function personName(user: { name: string } | null): string {
  return user?.name ?? people.formerMember;
}
