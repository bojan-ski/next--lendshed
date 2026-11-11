import "server-only";

// Prisma's `contains` passes \, % and _ through as LIKE wildcards, so a search
// for "%" would match everything. Escaped with \, Postgres's default LIKE escape.
export function containsText(term: string) {
  return {
    contains: term.replace(/[\\%_]/g, (char) => `\\${char}`),
    mode: "insensitive" as const,
  };
}
