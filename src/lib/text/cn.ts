import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// The theme's own radius names (globals.css), so `rounded-tile` replaces a
// component's default `rounded-card` instead of both landing on the element.
const twMerge = extendTailwindMerge({
  extend: {
    theme: { radius: ["band", "card", "tile", "thumb", "control"] },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
