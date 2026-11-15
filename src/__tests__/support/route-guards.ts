export type Guard = "none" | "viewerGate" | "requireOrganizer";

// The layouts that guard a route group, and the call each must contain. A page is
// classified by the nearest of these above it; a page under none of them fails.
export const GUARDING_LAYOUTS: Record<
  string,
  { guard: Guard; marker: string | null }
> = {
  "src/app/(public)/layout.tsx": { guard: "none", marker: null },
  "src/app/(app)/layout.tsx": { guard: "viewerGate", marker: "<ViewerGate>" },
  "src/app/(app)/admin/layout.tsx": {
    guard: "requireOrganizer",
    marker: "<OrganizerGate>",
  },
};

// Every guarding layout above the page, nearest first.
export function guardChain(
  pageFile: string,
  layouts: Iterable<string>,
): Guard[] {
  const known = new Set(layouts);
  const chain: Guard[] = [];
  let dir = pageFile.slice(0, pageFile.lastIndexOf("/"));
  while (dir.startsWith("src/app")) {
    const layout = `${dir}/layout.tsx`;
    if (known.has(layout) && layout in GUARDING_LAYOUTS) {
      chain.push(GUARDING_LAYOUTS[layout].guard);
    }
    dir = dir.slice(0, dir.lastIndexOf("/"));
  }
  if (chain.length === 0) {
    throw new Error(`${pageFile} sits under no guarding layout`);
  }
  return chain;
}
