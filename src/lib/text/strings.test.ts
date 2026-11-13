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
// A name can end in an initial ("Ruth K."), so a sentence ending in a person
// placeholder would read "Ruth K.." (17a ui-reviewer).
test("no UI string ends a sentence on a person placeholder", () => {
  const PERSON = /\{(name|owner|borrower|actor)\}[.!?]$/;
  expect(allStrings(strings).filter((text) => PERSON.test(text))).toEqual([]);
});

test("no UI string spells out the app name; {appName} carries it", () => {
  const name = publicEnv.NEXT_PUBLIC_APP_NAME;
  expect(allStrings(strings).filter((text) => text.includes(name))).toEqual([]);
});
