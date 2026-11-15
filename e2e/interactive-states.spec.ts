import {
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import { communityToday } from "@/lib/dates/dates";
import { account } from "@/strings/account";
import { avatarMenu } from "@/strings/avatarMenu";
import { categories } from "@/strings/categories";
import { invitations } from "@/strings/invitations";
import { itemPage } from "@/strings/itemPage";
import { items } from "@/strings/items";
import { loanActions } from "@/strings/loanActions";
import { login } from "@/strings/login";
import { members } from "@/strings/members";
import { oneTimeLink } from "@/strings/oneTimeLink";
import { callDb } from "./support/db-call";
import type {
  InteractiveLoans,
  InteractiveTargets,
  ResponsiveTargets,
} from "./support/db";
import {
  expectNoOverflow,
  focusedViolations,
  phoneContexts,
  signIn,
  targetViolations,
} from "./support/phone-checks";
import type { Persona } from "./support/responsive-pages";
import {
  currentTag,
  invitationNote,
  seedBorrowerEmail,
  seedOrganizer,
} from "./support/run";

// Spec 26: the states spec 25's at-rest sweep can't see, at 360 × 800. Each is
// opened by keyboard (so focus-visible applies where focus lands), checked,
// then closed. No confirm step is ever confirmed; field errors come from input
// the server refuses. The only writes are run rows: one invitation, one Hidden
// item with two loans, and rate-limit rows by run address.

test.describe.configure({ mode: "serial" });

type Found<T> = Exclude<T, { fix: string }>;

let contexts = new Map<Persona, BrowserContext>();
let memberEmail: string;
let ownItemId: string;
let memberId: string;
let interactive: Found<InteractiveTargets>;
let loans: Found<InteractiveLoans>;

function found<T extends object>(result: T | { fix: string }): T {
  if ("fix" in result) throw new Error(result.fix);
  return result;
}

const lookUpInteractive = () =>
  found(
    callDb<InteractiveTargets>("interactive-targets", {
      organizerEmail: seedOrganizer().email,
      memberEmail,
      tag: currentTag(),
      today: communityToday(),
    }),
  );

// Strings templates with `{…}` placeholders as one exact name pattern.
const named = (...templates: string[]) =>
  new RegExp(
    `^(?:${templates
      .map((template) =>
        template
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
          .replace(/\\\{\w+\\\}/g, ".+"),
      )
      .join("|")})$`,
  );

const WHITESPACE = "   ";

test.beforeAll(async ({ browser }) => {
  const today = communityToday();
  const responsive = found(
    callDb<ResponsiveTargets>("responsive-targets", {
      organizerEmail: seedOrganizer().email,
      today,
    }),
  );
  memberEmail = responsive.memberEmail;
  ownItemId = responsive.params["/my/items/[id]/edit"].id;
  memberId = responsive.params["/admin/members/[id]"].id;
  interactive = lookUpInteractive();
  loans = found(
    callDb<InteractiveLoans>("interactive-loans", {
      tag: currentTag(),
      ownerEmail: memberEmail,
      seedBorrowerEmail: seedBorrowerEmail(),
      today,
    }),
  );

  contexts = await phoneContexts(browser, currentTag());
  for (const [persona, email] of [
    ["member", memberEmail],
    ["organizer", seedOrganizer().email],
  ] as const) {
    const page = await contexts.get(persona)!.newPage();
    await signIn(page, email);
    await page.close();
  }
});

test.afterAll(async () => {
  for (const context of contexts.values()) await context.close();
  if (!interactive) return;
  expect(
    lookUpInteractive().fingerprint,
    "no seed row changed during the sweep",
  ).toBe(interactive.fingerprint);
});

async function open(
  persona: Persona,
  url: string,
  ready: (page: Page) => Locator,
) {
  const page = await contexts.get(persona)!.newPage();
  await page.goto(url);
  await expect(ready(page)).toBeVisible();
  return page;
}

// Keyboard activation: focus, then Enter.
async function press(control: Locator) {
  await control.focus();
  await control.press("Enter");
}

async function expectPhoneState(page: Page) {
  await expectNoOverflow(page);
  expect(await targetViolations(page), "target sizes").toEqual([]);
  expect(await focusedViolations(page), "visible focus").toEqual([]);
}

// Opens a confirm step, checks it, then leaves through its Keep button; the
// confirm button is never pressed. Keep exists only inside the step (a toggle
// and its confirm button can share a label: "Cancel loan").
async function confirmStep(
  page: Page,
  toggle: Locator,
  confirm: Locator,
  keep: Locator,
) {
  await press(toggle);
  await expect(keep).toBeVisible();
  await expect(confirm).toBeVisible();
  await expectPhoneState(page);
  await press(keep);
  await expect(keep).toBeHidden();
}

// Fills a field with whitespace, submits with Enter and waits for the
// server's field error.
async function fieldError(page: Page, field: Locator, error: string) {
  await field.fill(WHITESPACE);
  await field.press("Enter");
  await expect(page.getByText(error, { exact: true })).toBeVisible();
  await expectPhoneState(page);
}

test("1. the avatar menu, open", async () => {
  const trigger = (page: Page) => page.getByLabel(named(avatarMenu.label));
  const page = await open("member", "/", trigger);
  const accountLink = page.getByRole("link", {
    name: avatarMenu.account,
    exact: true,
  });
  await press(trigger(page));
  await expect(accountLink).toBeVisible();
  await expectPhoneState(page);
  await press(trigger(page));
  await expect(accountLink).toBeHidden();
  await page.close();
});

test("2. the delete-account confirm step", async () => {
  const toggle = (page: Page) =>
    page.getByRole("button", { name: account.deleteAccount, exact: true });
  const page = await open("member", "/account", toggle);
  await confirmStep(
    page,
    toggle(page),
    page.getByRole("button", {
      name: account.deleteConfirmButton,
      exact: true,
    }),
    page.getByRole("button", { name: account.keepAccount, exact: true }),
  );
  await page.close();
});

test("3. a profile field error", async () => {
  const name = (page: Page) =>
    page.getByLabel(account.nameLabel, { exact: true });
  const page = await open("member", "/account", name);
  await fieldError(page, name(page), account.nameTooShort);
  await page.close();
});

test("4. the Delete or Retire confirm step on an own item", async () => {
  const toggle = (page: Page) =>
    page.getByRole("button", { name: named(items.deleteFor, items.retireFor) });
  const page = await open("member", `/my/items/${ownItemId}/edit`, toggle);
  await confirmStep(
    page,
    toggle(page),
    page.getByRole("button", {
      name: named(items.deleteConfirmButton, items.retireConfirmButton),
    }),
    page.getByRole("button", { name: items.keep, exact: true }),
  );
  await page.close();
});

test("5. organizer retire, a note field error", async () => {
  const toggle = (page: Page) =>
    page.getByRole("button", { name: named(items.retireFor) });
  const page = await open(
    "organizer",
    `/items/${interactive.organizerItemId}`,
    toggle,
  );
  await press(toggle(page));
  const note = page.getByLabel(itemPage.retireNoteLabel, { exact: true });
  await note.fill(WHITESPACE);
  await press(
    page.getByRole("button", { name: items.retireConfirmButton, exact: true }),
  );
  await expect(
    page.getByText(itemPage.retireNoteRequired, { exact: true }),
  ).toBeVisible();
  await expectPhoneState(page);
  await press(page.getByRole("button", { name: itemPage.keep, exact: true }));
  await expect(note).toBeHidden();
  await page.close();
});

test("6. the suspend confirm step", async () => {
  const toggle = (page: Page) =>
    page.getByRole("button", { name: named(members.suspendFor) });
  const page = await open("organizer", `/admin/members/${memberId}`, toggle);
  await confirmStep(
    page,
    toggle(page),
    page.getByRole("button", { name: members.suspend, exact: true }),
    page.getByRole("button", { name: members.keepActive, exact: true }),
  );
  await page.close();
});

test("7. the delete-member confirm step", async () => {
  const toggle = (page: Page) =>
    page.getByRole("button", { name: named(members.deleteFor) });
  const page = await open(
    "organizer",
    `/admin/members/${interactive.suspendedMemberId}`,
    toggle,
  );
  await confirmStep(
    page,
    toggle(page),
    page.getByRole("button", { name: members.deleteAccount, exact: true }),
    page.getByRole("button", { name: members.keepAccount, exact: true }),
  );
  await page.close();
});

test("8. a new-category field error", async () => {
  const name = (page: Page) => page.locator("#category-name");
  const page = await open("organizer", "/admin/categories", name);
  await expect(name(page)).toHaveAccessibleName(
    new RegExp(`^${categories.nameLabel}`),
  );
  await fieldError(page, name(page), categories.nameTooShort);
  await page.close();
});

test("9. the one-time link panel", async () => {
  const note = (page: Page) =>
    page.getByLabel(invitations.noteLabel, { exact: true });
  const page = await open("organizer", "/admin/invitations", note);
  await note(page).fill(invitationNote(currentTag(), "panel"));
  await note(page).press("Enter");
  await expect(
    page.getByRole("heading", {
      name: named(oneTimeLink.heading, oneTimeLink.headingFor),
    }),
  ).toBeFocused();
  await expectPhoneState(page);
  await page.close();
});

test("10. the decline-reason confirm step", async () => {
  const toggle = (page: Page) =>
    page.getByRole("button", { name: loanActions.decline, exact: true });
  const page = await open("member", `/loans/${loans.requestLoanId}`, toggle);
  await confirmStep(
    page,
    toggle(page),
    page.getByRole("button", { name: loanActions.declineConfirm, exact: true }),
    page.getByRole("button", { name: loanActions.keep, exact: true }),
  );
  await page.close();
});

test("11. the cancel-approved confirm step", async () => {
  const toggle = (page: Page) =>
    page.getByRole("button", { name: loanActions.cancelLoan, exact: true });
  const page = await open("member", `/loans/${loans.approvedLoanId}`, toggle);
  await confirmStep(
    page,
    toggle(page),
    page.getByRole("button", {
      name: loanActions.cancelLoanConfirm,
      exact: true,
    }),
    page.getByRole("button", { name: loanActions.keep, exact: true }),
  );
  await page.close();
});

test("12. the sign-in error notice", async () => {
  const password = (page: Page) =>
    page.getByLabel(login.passwordLabel, { exact: true });
  const page = await open("guest", "/login", password);
  await page.getByLabel(login.emailLabel, { exact: true }).fill(memberEmail);
  await password(page).fill(`${WHITESPACE}not the password`);
  await password(page).press("Enter");
  await expect(
    page.getByText(login.invalidCredentials, { exact: true }),
  ).toBeVisible();
  await expectPhoneState(page);
  await page.close();
});
