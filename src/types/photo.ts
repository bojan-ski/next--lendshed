import type { FlashKey } from "@/strings";

export type UploadCounts = {
  monthCount: number;
  dayCount: number;
  storedBytes: number;
};

// A file already in storage, ready to swap onto its item.
export type StoredPhoto = {
  key: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
};

export type ItemPhotoState = {
  fieldErrors?: { photo?: string[] };
  formError?:
    | "stale"
    | "monthlyCap"
    | "dailyCap"
    | "storageFull"
    | "unreadable"
    | "unexpected";
  // Only with monthlyCap / dailyCap.
  reopensOnLabel?: string;
  flash?: FlashKey;
};
