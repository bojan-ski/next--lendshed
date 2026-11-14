export type UsageCounts = {
  monthCount: number;
  storedBytes: number;
  listedCount: number;
};

export type UsageMeter = { used: number; percent: number; warn: boolean };

export type UsageDTO = {
  monthLabel: string;
  uploads: UsageMeter & { cap: number };
  storedBytes: UsageMeter & { cap: number };
  listedItems: UsageMeter & { warnAt: number };
};
