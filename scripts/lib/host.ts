// Operator output names the database host only: never the URL, user or password.
// No Prisma import: the Playwright config loads this module (spec 17).
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "(unknown host)";
  } catch {
    return "(unknown host)";
  }
}
