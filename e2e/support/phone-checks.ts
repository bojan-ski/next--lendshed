import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
} from "@playwright/test";
import { buttonClasses } from "@/components/ui/button-styles";
import { login } from "@/strings/login";
import { DEMO_PASSWORD } from "../../prisma/seed/people";
import { E2E_ORIGIN, E2E_PHONE_VIEWPORT } from "./env";
import type { Persona } from "./responsive-pages";
import { addressOf, type Role } from "./run";

// The 360 px checks shared by spec 25's page sweep and spec 26's interactive
// states (moved from responsive.spec.ts unchanged).

export const MIN_TARGET = 44;
export const KIT_HEIGHT = 48;
export const MAX_TAB_STOPS = 30;
export const REDUCED_MS = 0.01;

// The classes every kit button carries, whatever its variant.
const KIT_CLASSES = buttonClasses("primary")
  .split(" ")
  .filter((name) => buttonClasses("outline").split(" ").includes(name));

const ADDRESS: Record<Persona, Role> = {
  guest: "borrower",
  member: "seedBorrower",
  organizer: "organizer",
};

// One phone-sized context per persona, each on its own run address.
export async function phoneContexts(
  browser: Browser,
  tag: string,
): Promise<Map<Persona, BrowserContext>> {
  const contexts = new Map<Persona, BrowserContext>();
  for (const persona of ["guest", "member", "organizer"] as const) {
    const context = await browser.newContext({
      baseURL: E2E_ORIGIN,
      viewport: E2E_PHONE_VIEWPORT,
      extraHTTPHeaders: { "x-forwarded-for": addressOf(tag, ADDRESS[persona]) },
    });
    contexts.set(persona, context);
  }
  return contexts;
}

export async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel(login.emailLabel, { exact: true }).fill(email);
  await page
    .getByLabel(login.passwordLabel, { exact: true })
    .fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: login.submit }).click();
  await expect(page).toHaveURL((url) => url.pathname === "/");
}

// Rule 1: nothing scrolls sideways.
export async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(overflow.scroll, "no horizontal overflow").toBeLessThanOrEqual(
    overflow.client,
  );
}

// Rule 2: every visible target is at least 44 × 44; kit buttons are 48 high
// with no vertical overflow. Structural exceptions only: an inline text link
// (WCAG 2.2 2.5.8), a labelled checkbox or radio measured by its label, and an
// element hidden at rest (≤ 1 px or fully clipped), measured by its label or
// left to the Tab walk.
export function targetViolations(page: Page) {
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

// One stop's problems: the 2 px accent ring at a 2 px offset, and a target
// size when it only appears on focus.
function stopViolations(info: FocusStop) {
  const outline: string[] = [];
  const appearing: string[] = [];
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
  return { outline, appearing };
}

// Rule 3: Tab from the top; every stop shows the 2 px accent ring at a 2 px
// offset, and a stop that only appears on focus is target-sized (rule 2).
export async function focusViolations(page: Page) {
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
    const found = stopViolations(info);
    outline.push(...found.outline);
    appearing.push(...found.appearing);
  }
  return { outline, appearing };
}

// Rule 3 for an open state (spec 26): the element focus landed on, without
// tabbing away (a Tab walk would leave an open menu or confirm step).
export async function focusedViolations(page: Page): Promise<string[]> {
  await markHiddenAtRest(page);
  const info = await focusStop(page);
  if (info.done) return ["nothing is focused"];
  const { outline, appearing } = stopViolations(info);
  return [...outline, ...appearing];
}

export const toMs = (entry: string) => {
  const match = /^(-?[\d.]+(?:e[+-]?\d+)?)(ms|s)$/i.exec(entry.trim());
  if (!match) return Number.NaN;
  return Number(match[1]) * (match[2].toLowerCase() === "s" ? 1000 : 1);
};

// Every element's transition and animation durations, in ms, plus html's
// scroll-behavior, under the current reduced-motion setting.
export function motionState(page: Page) {
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
