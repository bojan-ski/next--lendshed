import type { UploadCounts } from "@/types/photo";

// Free-tier guards (decimal MB). Spec 21's usage panel reads the same numbers.
export const UPLOAD_LIMITS = {
  monthly: 1500,
  dailyPerMember: 20,
  storedBytes: 800_000_000,
} as const;

export type UploadCapRefusal = "storageFull" | "monthlyCap" | "dailyCap";

// Storage first: it has no reopen date, so it outranks the other two.
export function uploadCapRefusal(counts: UploadCounts): UploadCapRefusal | null {
  if (counts.storedBytes >= UPLOAD_LIMITS.storedBytes) return "storageFull";
  if (counts.monthCount >= UPLOAD_LIMITS.monthly) return "monthlyCap";
  if (counts.dayCount >= UPLOAD_LIMITS.dailyPerMember) return "dailyCap";
  return null;
}
