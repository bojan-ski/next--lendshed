import { type BrowserContext, expect, test } from "@playwright/test";
import { routeParams, routeUrl } from "@/__tests__/support/routeParams";
import { communityToday } from "@/lib/dates/dates";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
import type { FlashKey } from "@/strings";
import { admin } from "@/strings/admin";
import { flash } from "@/strings/flash";
import { login } from "@/strings/login";
import { toast as toastStrings } from "@/strings/toast";
import { callDb } from "./support/db-call";
import type { ResponsiveTargets } from "./support/db";
import { E2E_ORIGIN } from "./support/env";
import {
  expectNoOverflow,
  focusViolations,
  MIN_TARGET,
  motionState,
  phoneContexts,
  REDUCED_MS,
  signIn,
  targetViolations,
  toMs,
} from "./support/phone-checks";
import {
  type Persona,
  RESPONSIVE_PAGES,
  type ResponsivePage,
} from "./support/responsive-pages";
import { currentTag, seedOrganizer } from "./support/run";

// Spec 25: every page at 360 × 800 as the persona its guard admits, on the
// existing seed. Creates no row; the two sign-ins' sessions and rate-limit rows
// go with teardown's address-based cleanup. The organizer opens the loan page
// as a non-party, so no seen-at value changes.

test.describe.configure({ mode: "serial" });

type Targets = Exclude<ResponsiveTargets, { fix: string }>;

let targets: Targets;
let contexts = new Map<Persona, BrowserContext>();

function lookUpTargets(): Targets {
  const result = callDb<ResponsiveTargets>("responsive-targets", {
    organizerEmail: seedOrganizer().email,
    today: communityToday(),
  });
  if ("fix" in result) throw new Error(result.fix);
  return result;
}

const urlOf = ({ pattern }: ResponsivePage) =>
  pattern.endsWith("[token]")
    ? routeUrl(pattern, routeParams)
    : routeUrl(pattern, targets.params);

test.beforeAll(async ({ browser }) => {
  targets = lookUpTargets();
  contexts = await phoneContexts(browser, currentTag());
  for (const [persona, email] of [
    ["member", targets.memberEmail],
    ["organizer", seedOrganizer().email],
  ] as const) {
    const page = await contexts.get(persona)!.newPage();
    await signIn(page, email);
    await page.close();
  }
});

test.afterAll(async () => {
  for (const context of contexts.values()) await context.close();
  if (!targets) return;
  const after = lookUpTargets();
  expect(after.params["/loans/[id]"]).toEqual(targets.params["/loans/[id]"]);
  expect(after.loanSeenAt, "the seed loan's seen-at values").toEqual(
    targets.loanSeenAt,
  );
});

// On-focus size problems from every page, asserted once after the 20 pages:
// the skip link (on every page) is one finding, not twenty page failures.
const appearingOnFocus = new Set<string>();

async function open(persona: Persona, url: string, ready: string) {
  const page = await contexts.get(persona)!.newPage();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto(url);
  await expect(page.locator(ready).first()).toBeVisible();
  return page;
}

for (const entry of RESPONSIVE_PAGES) {
  test(`${entry.pattern} at 360 px (${entry.persona})`, async () => {
    const page = await open(entry.persona, urlOf(entry), entry.ready);

    await expectNoOverflow(page);

    expect(await targetViolations(page), "target sizes").toEqual([]);
    const focus = await focusViolations(page);
    expect(focus.outline, "visible focus").toEqual([]);
    for (const problem of focus.appearing) appearingOnFocus.add(problem);

    if (entry.pattern.startsWith("/admin")) {
      await expect(
        page.getByRole("navigation", { name: admin.menuLabel, exact: true }),
      ).toBeHidden();
    }

    await page.emulateMedia({ reducedMotion: "reduce" });
    const reduced = await motionState(page);
    expect(reduced.reduce).toBe(true);
    expect(reduced.scroll).toBe("auto");
    const slow = reduced.durations.flatMap(({ label, values }) =>
      values
        .filter((value) => !(toMs(value) <= REDUCED_MS + 1e-9))
        .map((value) => `${label} ${value}`),
    );
    expect(slow, "durations under reduced motion").toEqual([]);

    await page.close();
  });
}

// F25-2 was the skip link losing its padding to `focus:not-sr-only` (158 × 26).
test("elements shown only on focus are target-sized", () => {
  expect([...appearingOnFocus]).toEqual([]);
});

test("the Toaster at 360 px: visible, a target-sized close, motion only without reduce", async () => {
  const key = "profileSaved" satisfies FlashKey;
  const context = contexts.get("guest")!;
  const setFlash = () =>
    context.addCookies([
      { name: FLASH_COOKIE, value: encodeURIComponent(key), url: E2E_ORIGIN },
    ]);

  await setFlash();
  const page = await open(
    "guest",
    "/login",
    `role=button[name="${login.submit}"]`,
  );
  const close = page.getByRole("button", { name: toastStrings.close });
  await expect(
    page.getByRole("status").filter({ hasText: flash[key] }),
  ).toBeVisible();
  const box = await close.boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(MIN_TARGET);
  expect(box?.height).toBeGreaterThanOrEqual(MIN_TARGET);
  const card = close.locator("..");
  const duration = () =>
    card.evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(toMs(await duration())).toBeGreaterThan(0);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await setFlash();
  await page.reload();
  await expect(close).toBeVisible();
  expect(toMs(await duration())).toBeLessThanOrEqual(REDUCED_MS + 1e-9);
  await page.close();
});
