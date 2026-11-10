import { publicEnv } from "@/lib/env/public";
import { strings } from "@/strings";

function allStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(allStrings);
  }
  return [];
}

// The app name is a placeholder (OQ-01) set in NEXT_PUBLIC_APP_NAME; a string
// that spells it out would keep the old name after a rename.
test("no UI string spells out the app name; {appName} carries it", () => {
  const name = publicEnv.NEXT_PUBLIC_APP_NAME;
  expect(allStrings(strings).filter((text) => text.includes(name))).toEqual([]);
});
