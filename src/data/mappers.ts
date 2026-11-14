import "server-only";
import { formatMonth } from "@/lib/dates/dates";
import {
  LISTED_ITEMS_WARN_AT,
  UPLOAD_LIMITS,
  USAGE_WARN_PERCENT,
} from "@/lib/photos/caps";
import { people } from "@/strings/people";
import type { PhotoDTO } from "@/types/item";
import type { UsageCounts, UsageDTO, UsageMeter } from "@/types/usage";

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

// Integers only; a race past a cap shows its real percent, never clamped.
function meter(used: number, limit: number, warn: boolean): UsageMeter {
  return { used, percent: Math.floor((used * 100) / limit), warn };
}

const pastWarnShare = (used: number, cap: number) =>
  used * 100 >= cap * USAGE_WARN_PERCENT;

export function toUsageDTO(counts: UsageCounts, today: string): UsageDTO {
  const { monthly, storedBytes } = UPLOAD_LIMITS;
  return {
    monthLabel: formatMonth(today),
    uploads: {
      ...meter(
        counts.monthCount,
        monthly,
        pastWarnShare(counts.monthCount, monthly),
      ),
      cap: monthly,
    },
    storedBytes: {
      ...meter(
        counts.storedBytes,
        storedBytes,
        pastWarnShare(counts.storedBytes, storedBytes),
      ),
      cap: storedBytes,
    },
    listedItems: {
      ...meter(
        counts.listedCount,
        LISTED_ITEMS_WARN_AT,
        counts.listedCount >= LISTED_ITEMS_WARN_AT,
      ),
      warnAt: LISTED_ITEMS_WARN_AT,
    },
  };
}
