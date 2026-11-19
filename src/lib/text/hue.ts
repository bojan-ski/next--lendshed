import type { CSSProperties } from "react";

// Decorative hues (marigold, green, tomato, pink, sky). Colour is never the
// only signal: the name is always shown.
export const HUES = [75, 145, 30, 340, 230] as const;

export type Hue = number;

// A category's hue is its position in the alphabetical list getCategories()
// returns, so the first five always differ. Renaming or adding one can shift
// the others' colours; that's fine for decoration.
export function categoryHues(
  categories: readonly { id: string }[],
): ReadonlyMap<string, Hue> {
  return new Map(
    categories.map(({ id }, index) => [id, HUES[index % HUES.length]]),
  );
}

// A person's hue (initials avatars): a stable hash of the id, so it never
// needs a list. Two people may share one.
export function hueFor(id: string): Hue {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return HUES[hash % HUES.length];
}

// Sets --hue, which the hue-* colours in globals.css resolve against.
export function hueStyle(hue: Hue): CSSProperties {
  return { "--hue": hue } as CSSProperties;
}
