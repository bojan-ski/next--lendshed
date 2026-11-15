import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { routeParams, routeUrl } from "@/__tests__/support/routeParams";
import { buttonClasses } from "@/components/ui/button-styles";
import { communityToday } from "@/lib/dates/dates";
import { FLASH_COOKIE } from "@/lib/feedback/toast";
import type { FlashKey } from "@/strings";
import { admin } from "@/strings/admin";
import { flash } from "@/strings/flash";
import { login } from "@/strings/login";
import { toast as toastStrings } from "@/strings/toast";
import { DEMO_PASSWORD } from "../prisma/seed/people";
import { callDb } from "./support/db-call";
import type { ResponsiveTargets } from "./support/db";
import { E2E_ORIGIN, E2E_PHONE_VIEWPORT } from "./support/env";
import {
  type Persona,
  RESPONSIVE_PAGES,
  type ResponsivePage,
} from "./support/responsive-pages";
import { addressOf, currentTag, type Role, seedOrganizer } from "./support/run";

// Spec 25: every page at 360 × 800 as the persona its guard admits, on the
// existing seed. Creates no row; the two sign-ins' sessions and rate-limit rows
// go with teardown's address-based cleanup. The organizer opens the loan page
// as a non-party, so no seen-at value changes.

test.describe.configure({ mode: "serial" });

const MIN_TARGET = 44;
const KIT_HEIGHT = 48;
const MAX_TAB_STOPS = 30;
const REDUCED_MS = 0.01;

// The classes every kit button carries, whatever its variant.
const KIT_CLASSES = buttonClasses("primary")
  .split(" ")
  .filter((name) => buttonClasses("outline").split(" ").includes(name));

const ADDRESS: Record<Persona, Role> = {
  guest: "borrower",
  member: "seedBorrower",
  organizer: "organizer",
};

type Targets = Exclude<ResponsiveTargets, { fix: string }>;

let targets: Targets;
const contexts = new Map<Persona, BrowserContext>();

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

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(login.emailLabel, { exact: true }).fill(email);
  await page
    .getByLabel(login.passwordLabel, { exact: true })
    .fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: login.submit }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
}

test.beforeAll(async ({ browser }) => {
  targets = lookUpTargets();
  const tag = currentTag();
  for (const persona of ["guest", "member", "organizer"] as const) {
    const context = await browser.newContext({
      baseURL: E2E_ORIGIN,
      viewport: E2E_PHONE_VIEWPORT,
      extraHTTPHeaders: { "x-forwarded-for": addressOf(tag, ADDRESS[persona]) },
    });
    contexts.set(persona, context);
  }
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

// Rule 2: every visible target is at least 44 × 44; kit buttons are 48 high
// with no vertical overflow. Structural exceptions only: an inline text link
// (WCAG 2.2 2.5.8), a labelled checkbox or radio measured by its label, and an
// element hidden at rest (≤ 1 px or fully clipped), measured by its label or
// left to the Tab walk.
function targetViolations(page: Page) {
  return page.evaluate(
    ({ min, kitHeight, kitClasses }) => {
      const SELECTOR =
        'a[href], button, summary, select, textarea, input:not([type="hidden"]), [role="button"], [tabindex="0"]';
      const describe = (el: Element, box: DOMRect) =>
        `${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute("aria-label") ?? "").trim().slice(0, 40)}" ${Math.round(box.width)}×${Math.round(box.height)}`;
      const isInlineTextLink = (el: Element) => {
        if (el.tagName !== "A" || getComputedStyle(el).display !== "inline") {
          return false;
        }
        const parentText = el.parentElement?.textContent ?? "";
        return parentText.replace(el.textContent ?? "", "").trim().length > 0;
      };
      // `sr-only`: a 1 px box, or fully clipped when the element's own padding
      // outlasts sr-only's (the skip link's box is 34 × 26, but none of it shows).
      const hiddenAtRest = (el: Element, box: DOMRect) => {
        const style = getComputedStyle(el);
        return (
          box.width <= 1 ||
          box.height <= 1 ||
          style.clipPath === "inset(50%)" ||
          style.clip === "rect(0px, 0px, 0px, 0px)"
        );
      };
      const problems: string[] = [];
      for (const el of document.querySelectorAll(SELECTOR)) {
        if (!el.checkVisibility({ visibilityProperty: true })) continue;
        if (isInlineTextLink(el)) continue;
        let measured: Element = el;
        let box = el.getBoundingClientRect();
        const label =
          el instanceof HTMLInputElement ? (el.labels?.[0] ?? null) : null;
        const toggle =
          el instanceof HTMLInputElement &&
          (el.type === "checkbox" || el.type === "radio");
        const hidden = hiddenAtRest(el, box);
        if (label && (toggle || hidden)) {
          measured = label;
          box = label.getBoundingClientRect();
        } else if (hidden) {
          continue; // hidden at rest: the Tab walk checks it when focused
        }
        if (box.width < min || box.height < min) {
          problems.push(describe(measured, box));
        }
        if (kitClasses.every((name) => measured.classList.contains(name))) {
          const html = measured as HTMLElement;
          if (box.height < kitHeight || html.scrollHeight > html.clientHeight) {
            problems.push(`kit ${describe(measured, box)}`);
          }
        }
      }
      return problems;
    },
    { min: MIN_TARGET, kitHeight: KIT_HEIGHT, kitClasses: KIT_CLASSES },
  );
}

type FocusStop = {
  done: boolean;
  // Hidden at rest and unlabelled: it only appears on focus (the skip link).
  appeared: boolean;
  label: string;
  outline: string;
  accent: string;
  box: { width: number; height: number };
};

type FocusStore = { __seen?: WeakSet<Element>; __hidden?: WeakSet<Element> };

// Before the walk: every element hidden at rest (≤ 1 px or fully clipped).
function markHiddenAtRest(page: Page) {
  return page.evaluate(() => {
    const store = window as unknown as FocusStore;
    store.__seen = new WeakSet();
    store.__hidden = new WeakSet();
    for (const el of document.querySelectorAll("*")) {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (
        box.width <= 1 ||
        box.height <= 1 ||
        style.clipPath === "inset(50%)" ||
        style.clip === "rect(0px, 0px, 0px, 0px)"
      ) {
        store.__hidden.add(el);
      }
    }
  });
}

// The focused element (or the label of a visually hidden one) and its outline.
function focusStop(page: Page): Promise<FocusStop> {
  return page.evaluate(() => {
    const store = window as unknown as FocusStore;
    const seen = store.__seen!;
    const el = document.activeElement;
    // Next's dev-tools host sits in a shadow root outside the app's DOM.
    if (!el || el === document.body || el.shadowRoot || seen.has(el)) {
      return {
        done: true,
        appeared: false,
        label: "",
        outline: "",
        accent: "",
        box: { width: 0, height: 0 },
      };
    }
    seen.add(el);
    let target: Element = el;
    const hidden = store.__hidden!.has(el);
    const labelled = el instanceof HTMLInputElement && el.labels?.[0];
    if (hidden && labelled) target = labelled;
    const style = getComputedStyle(target);
    const probe = document.createElement("span");
    probe.style.color = "var(--color-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    const box = target.getBoundingClientRect();
    return {
      done: false,
      appeared: hidden && !labelled,
      label: `${target.tagName.toLowerCase()} "${(target.textContent ?? "").trim().slice(0, 40)}"`,
      outline: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineOffset} ${style.outlineColor}`,
      accent,
      box: { width: box.width, height: box.height },
    };
  });
}

// Rule 3: Tab from the top; every stop shows the 2 px accent ring at a 2 px
// offset, and a stop that only appears on focus is target-sized (rule 2).
async function focusViolations(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await markHiddenAtRest(page);
  const outline: string[] = [];
  const appearing: string[] = [];
  for (let stop = 0; stop < MAX_TAB_STOPS; stop++) {
    await page.keyboard.press("Tab");
    const info = await focusStop(page);
    if (info.done) break;
    const expected = `solid 2px 2px ${info.accent}`;
    if (info.outline !== expected) {
      outline.push(`${info.label}: ${info.outline} (want ${expected})`);
    }
    const { width, height } = info.box;
    if (info.appeared && (width < MIN_TARGET || height < MIN_TARGET)) {
      appearing.push(
        `${info.label}: ${Math.round(width)}×${Math.round(height)} on focus`,
      );
    }
  }
  return { outline, appearing };
}

// On-focus size problems from every page, asserted once after the 20 pages:
// the skip link (on every page) is one finding, not twenty page failures.
const appearingOnFocus = new Set<string>();

const toMs = (entry: string) => {
  const match = /^(-?[\d.]+(?:e[+-]?\d+)?)(ms|s)$/i.exec(entry.trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1);
};

// Every element's transition and animation durations, in ms, plus html's
// scroll-behavior, under the current reduced-motion setting.
function motionState(page: Page) {
  return page.evaluate(() => {
    const durations: { label: string; values: string[] }[] = [];
    for (const el of document.querySelectorAll("*")) {
      const style = getComputedStyle(el);
      durations.push({
        label: el.tagName.toLowerCase(),
        values: [
          ...style.transitionDuration.split(","),
          ...style.animationDuration.split(","),
        ],
      });
    }
    return {
      reduce: matchMedia("(prefers-reduced-motion: reduce)").matches,
      scroll: getComputedStyle(document.documentElement).scrollBehavior,
      durations,
    };
  });
}

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

    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, "no horizontal overflow").toBeLessThanOrEqual(
      overflow.client,
    );

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

// F25-2 (spec 01's SkipLink): `focus:not-sr-only` resets padding, so the
// focused link is 158 × 26. Remove the mark when fix/skip-link-target lands.
test.fail("elements shown only on focus are target-sized (F25-2)", () => {
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
