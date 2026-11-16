import { readSource, sourceFiles } from "@/__tests__/support/import-graph";

// Spec 27 walkthrough, W-05: a member's notFound() from OrganizerGate stops
// Next's dev-time instant validation, which logs a console error on every
// /admin page. The opt-out works per page; on the layout it doesn't.
describe("admin pages opt out of instant validation", () => {
  const pages = sourceFiles("src/app/(app)/admin/**/page.tsx");

  test("all six admin pages are found", () => {
    expect(pages).toHaveLength(6);
  });

  test.each(pages)("%s exports instant = false", (file) => {
    expect(readSource(file)).toMatch(/^export const instant = false;$/m);
  });
});
