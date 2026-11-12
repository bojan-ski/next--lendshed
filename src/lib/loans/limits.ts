// Open (effective requested) loans a member may hold: per item and overall.
export const REQUEST_LIMITS = { perItem: 1, overall: 5 } as const;

// The latest start date a request may name, in days after today.
export const REQUEST_AHEAD_DAYS = 60;
