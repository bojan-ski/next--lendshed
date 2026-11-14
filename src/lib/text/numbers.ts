// Locale-free, so server and browser always agree.
export function formatCount(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// Decimal MB, rounded down to one decimal in whole tenths (no float division).
export function formatMegabytes(bytes: number): string {
  const tenths = Math.floor(bytes / 100_000);
  const whole = formatCount(Math.floor(tenths / 10));
  const tenth = tenths % 10;
  return tenth === 0 ? whole : `${whole}.${tenth}`;
}
