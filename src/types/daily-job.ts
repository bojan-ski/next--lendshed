export type DailyJobStep =
  | "storeExpired"
  | "storeLapsed"
  | "retryBlobDeletions"
  | "purgeInvitations"
  | "purgeResetGrants"
  | "purgeSessions"
  | "purgeVerifications"
  | "purgeRateLimits";

export type DailyJobResult = {
  today: string;
  counts: Record<DailyJobStep, number | null>;
  failed: DailyJobStep[];
};
