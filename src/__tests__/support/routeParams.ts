// The params each dynamic page receives in the consolidation route matrix, keyed by
// route pattern with groups stripped ("/invite/[token]"). The ONLY allow-list: a
// dynamic segment without an entry here fails the matrix. Never add a skip list.
export const routeParams: Record<string, Record<string, string | string[]>> = {
  "/invite/[token]": { token: "A".repeat(43) },
  "/reset/[token]": { token: "A".repeat(43) },
  "/admin/members/[id]": { id: "member-1" },
  "/my/items/[id]/edit": { id: "item-1" },
  "/items/[id]": { id: "item-1" },
  "/members/[id]": { id: "member-1" },
  "/loans/[id]": { id: "loan-1" },
};

const DYNAMIC_SEGMENT = /^\[{1,2}(?:\.\.\.)?([^\]]+)\]{1,2}$/;

// "src/app/(public)/login/page.tsx" → "/login"; groups and slots are not URL segments.
export function routePattern(pageFile: string): string {
  const segments = pageFile
    .replace(/^src\/app\//, "")
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));
  return `/${segments.join("/")}`;
}

// The concrete URL for a pattern, from `params` (defaults to `routeParams`).
export function routeUrl(
  pattern: string,
  params: Record<string, Record<string, string | string[]>> = routeParams,
): string {
  return pattern.replace(/\[{1,2}[^\]]+\]{1,2}/g, (segment) => {
    const name = DYNAMIC_SEGMENT.exec(segment)?.[1];
    const value = name ? params[pattern]?.[name] : undefined;
    if (value === undefined) {
      throw new Error(
        `No routeParams entry for ${pattern} (segment ${segment}) — add it to src/__tests__/support/routeParams.ts`,
      );
    }
    return [value].flat().map(encodeURIComponent).join("/");
  });
}
