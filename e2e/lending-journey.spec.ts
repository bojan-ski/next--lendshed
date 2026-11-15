import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { PRODUCTION_CATEGORIES } from "@/lib/categories/production";
import { addDays, communityToday, formatDateRange } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { account } from "@/strings/account";
import { flash } from "@/strings/flash";
import { home } from "@/strings/home";
import { invitations } from "@/strings/invitations";
import { itemPage } from "@/strings/itemPage";
import { items } from "@/strings/items";
import { join } from "@/strings/join";
import { loanActions } from "@/strings/loanActions";
import { loanPage } from "@/strings/loanPage";
import { login } from "@/strings/login";
import { myLoans } from "@/strings/myLoans";
import { nav } from "@/strings/nav";
import { oneTimeLink } from "@/strings/oneTimeLink";
import { photos } from "@/strings/photos";
import { requestForm } from "@/strings/requestForm";
import { status } from "@/strings/status";
import { DEMO_PASSWORD } from "../prisma/seed/people";
import { callDb } from "./support/db-call";
import { E2E_ORIGIN, E2E_VIEWPORT, testEnvValue } from "./support/env";
import { fixturePhotoPath } from "./support/photo";
import {
  addressOf,
  currentTag,
  invitationNote,
  itemTitle,
  ROLES,
  runEmail,
  seedBorrowerEmail,
  seedOrganizer,
  type Role,
} from "./support/run";

// The main lending journey (spec 17): one serial run, four people, each in
// their own browser context with their own address for the sign-in limit.

const PASSWORD = "e2e-journey-password";
const LENDER = { name: "Ada E.", contact: "Phone 555 0198" };
const BORROWER = { name: "Ben E.", contact: "Phone 555 0199" };

test.describe.configure({ mode: "serial" });

const contexts: BrowserContext[] = [];
const pages = new Map<Role, Page>();
const inviteLinks = new Map<"lender" | "borrower", string>();
let itemId = "";
let loanId = "";

function as(role: Role): Page {
  const page = pages.get(role);
  if (!page) throw new Error(`No page for ${role}`);
  return page;
}

const main = (page: Page) => page.getByRole("main");

async function expectToast(page: Page, message: string) {
  await expect(
    page.getByRole("status").filter({ hasText: message }),
  ).toBeVisible();
}

// The header link carries the needs-action count in its accessible name.
async function expectBadge(page: Page, count: 0 | 1) {
  const link = page
    .getByRole("navigation", { name: nav.label })
    .getByRole("link", { name: nav.myLoans });
  await expect(link).toHaveAccessibleName(
    count === 0 ? nav.myLoans : `${nav.myLoans} ${nav.needsYouOne}`,
  );
}

const pathIs = (pathname: string) => (url: URL) => url.pathname === pathname;

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel(login.emailLabel, { exact: true }).fill(email);
  await page.getByLabel(login.passwordLabel, { exact: true }).fill(password);
  await page.getByRole("button", { name: login.submit }).click();
}

async function joinAs(page: Page, who: "lender" | "borrower", name: string) {
  const link = inviteLinks.get(who);
  if (!link) throw new Error(`No invitation link for ${who}`);
  await page.goto(link);
  await page.getByLabel(join.nameLabel, { exact: true }).fill(name);
  await page
    .getByLabel(join.emailLabel, { exact: true })
    .fill(runEmail(currentTag(), who));
  await page.getByLabel(join.passwordLabel, { exact: true }).fill(PASSWORD);
  await page
    .getByRole("checkbox", {
      name: `${join.houseRulesBefore}${join.houseRulesLink}`,
    })
    .check();
  await page.getByRole("button", { name: join.submit }).click();
  await expectToast(
    page,
    t(flash.joined, { appName: testEnvValue("NEXT_PUBLIC_APP_NAME") }),
  );
}

async function saveContactDetails(page: Page, details: string) {
  await page.goto("/account");
  await page.getByRole("textbox", { name: account.contactLabel }).fill(details);
  await page.getByRole("button", { name: account.saveContact }).click();
  await expectToast(page, flash.contactDetailsSaved);
}

// A My loans group: its h2 names it, its list holds the cards.
const loanGroup = (page: Page, heading: string) =>
  main(page)
    .locator("section")
    .filter({
      has: page.getByRole("heading", { level: 2, name: heading, exact: true }),
    });

const loanStatusLabel = (page: Page, label: string) =>
  main(page).getByText(label, { exact: true });

test.beforeAll(async ({ browser }) => {
  const tag = currentTag();
  for (const role of ROLES) {
    const context = await browser.newContext({
      baseURL: E2E_ORIGIN,
      viewport: E2E_VIEWPORT,
      extraHTTPHeaders: { "x-forwarded-for": addressOf(tag, role) },
    });
    contexts.push(context);
    pages.set(role, await context.newPage());
  }
});

test.afterAll(async () => {
  for (const context of contexts) await context.close();
});

test("1 · a guest organizer is sent to sign in and back", async () => {
  const page = as("organizer");
  await page.goto("/admin/invitations");
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === "/login" &&
      url.searchParams.get("next") === "/admin/invitations",
  );
  await signIn(page, seedOrganizer().email, DEMO_PASSWORD);
  await expect(page).toHaveURL(pathIs("/admin/invitations"));
});

test("2 · the organizer creates two invitations", async () => {
  const page = as("organizer");
  for (const who of ["lender", "borrower"] as const) {
    const note = invitationNote(currentTag(), who);
    await page.getByLabel(invitations.noteLabel, { exact: true }).fill(note);
    await page.getByRole("button", { name: invitations.submit }).click();
    await expect(
      page.getByRole("heading", { name: t(oneTimeLink.headingFor, { note }) }),
    ).toBeVisible();
    const url = await page
      .getByLabel(oneTimeLink.fieldLabel, { exact: true })
      .inputValue();
    const { pathname } = new URL(url);
    expect(pathname).toMatch(/^\/invite\/[^/]+$/);
    inviteLinks.set(who, pathname);
  }
});

test("3 · the lender joins", async () => {
  await joinAs(as("lender"), "lender", LENDER.name);
});

test("4 · the lender saves contact details", async () => {
  await saveContactDetails(as("lender"), LENDER.contact);
});

test("5 · the lender adds an item with a photo and lists it", async () => {
  const page = as("lender");
  const title = itemTitle(currentTag());
  await page.goto("/my/items/new");
  await page.getByLabel(items.titleLabel, { exact: true }).fill(title);
  await page
    .getByLabel(items.categoryLabel, { exact: true })
    .selectOption({ label: PRODUCTION_CATEGORIES[0] });
  await page
    .getByLabel(items.conditionLabel, { exact: true })
    .selectOption({ label: items.condition.good });
  await page.getByLabel(items.maxLoanDaysLabel, { exact: true }).fill("7");
  await page.getByRole("button", { name: items.saveAndContinue }).click();

  await expect(page).toHaveURL(/\/my\/items\/[^/]+\/edit$/);
  itemId = new URL(page.url()).pathname.split("/")[3];
  await expect(page.getByText(photos.stepLine)).toBeVisible();

  const photo = page.getByLabel(photos.choose, { exact: true });
  await expect(photo).toBeEnabled();
  await photo.setInputFiles(fixturePhotoPath());
  await expectToast(page, flash.photoSaved);
  await expect(
    page.getByRole("img", { name: t(photos.previewAlt, { title }) }),
  ).toBeVisible();

  await page.getByRole("button", { name: items.list }).click();
  await expectToast(page, flash.itemListed);
  await expect(page.getByText(items.visibilityListed)).toBeVisible();
});

test("6 · the borrower joins and saves contact details", async () => {
  const page = as("borrower");
  await joinAs(page, "borrower", BORROWER.name);
  await saveContactDetails(page, BORROWER.contact);
});

test("7 · the borrower finds the item by search and category", async () => {
  const page = as("borrower");
  const tag = currentTag();
  const title = itemTitle(tag);
  await page.goto("/");
  await page.getByLabel(home.searchLabel, { exact: true }).fill(tag);
  await page.getByRole("button", { name: home.search, exact: true }).click();

  await expect(
    page.getByText(
      t(home.countOne, { page: 1 }) + t(home.forSearch, { q: tag }),
    ),
  ).toBeVisible();
  const card = main(page).getByRole("link", { name: title });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("href", `/items/${itemId}`);
  await expect(card.getByText(status.freeToday)).toBeVisible();

  await page
    .getByRole("navigation", { name: home.categoriesLabel })
    .getByRole("link", { name: PRODUCTION_CATEGORIES[0], exact: true })
    .click();
  await expect(page).toHaveURL((url) => url.searchParams.has("category"));
  await expect(main(page).getByRole("link", { name: title })).toHaveCount(1);
});

test("8 · the borrower requests the item", async () => {
  const page = as("borrower");
  const today = communityToday();
  await page.goto(`/items/${itemId}`);
  await expect(
    page.getByRole("heading", { name: itemPage.bookedHeading }),
  ).toBeVisible();
  await expect(page.getByText(itemPage.nothingBooked)).toBeVisible();

  await page.getByLabel(requestForm.from, { exact: true }).fill(today);
  await page
    .getByLabel(requestForm.to, { exact: true })
    .fill(addDays(today, 2));
  await page
    .getByLabel(t(requestForm.message, { owner: LENDER.name }), { exact: true })
    .fill("Could I borrow it for the weekend?");
  await page.getByRole("button", { name: requestForm.send }).click();

  await expect(page).toHaveURL(/\/loans\/[^/]+$/);
  loanId = new URL(page.url()).pathname.split("/")[2];
  await expectToast(page, flash.requestSent);
  await expect(loanStatusLabel(page, status.loan.requested)).toBeVisible();
});

test("9 · the lender's badge agrees with Needs you", async () => {
  const page = as("lender");
  await page.goto("/");
  await expectBadge(page, 1);

  await page.goto("/my/loans");
  await expect(
    page
      .getByRole("navigation", { name: myLoans.tabsLabel })
      .getByRole("link", { name: myLoans.tabs.lending }),
  ).toHaveAttribute("aria-current", "page");
  const needsYou = loanGroup(page, myLoans.groups.needs_you);
  await expect(needsYou.getByRole("listitem")).toHaveCount(1);
  await expect(
    needsYou.getByRole("heading", { name: itemTitle(currentTag()) }),
  ).toBeVisible();
});

test("10 · the lender approves and sees the borrower's contact", async () => {
  const page = as("lender");
  await page.goto(`/loans/${loanId}`);
  await page.getByRole("button", { name: loanActions.approve }).click();
  await expectToast(page, flash.loanApproved);
  await expect(loanStatusLabel(page, status.loan.approved)).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: t(loanPage.contactHeading, { name: BORROWER.name }),
    }),
  ).toBeVisible();
  await expect(page.getByText(BORROWER.contact)).toBeVisible();

  // The request became a hand over: the count stays 1.
  await expectBadge(page, 1);
  await page.reload();
  await expectBadge(page, 1);
});

test("11 · a seed member's overlapping request is refused", async () => {
  const page = as("seedBorrower");
  const today = communityToday();
  await page.goto("/login");
  await signIn(page, seedBorrowerEmail(), DEMO_PASSWORD);
  await expect(page).toHaveURL(pathIs("/"));

  await page.goto(`/items/${itemId}`);
  await expect(
    page.getByText(formatDateRange(today, addDays(today, 2), today)),
  ).toBeVisible();
  await page
    .getByLabel(requestForm.from, { exact: true })
    .fill(addDays(today, 1));
  await page
    .getByLabel(requestForm.to, { exact: true })
    .fill(addDays(today, 2));
  await page.getByRole("button", { name: requestForm.send }).click();

  await expect(page.getByText(requestForm.datesTaken)).toBeVisible();
  await expect(page).toHaveURL(pathIs(`/items/${itemId}`));
  expect(callDb<{ count: number }>("count-loans", { itemId }).count).toBe(1);
});

test("12 · the lender hands it over and the badge clears in place", async () => {
  const page = as("lender");
  await page.getByRole("button", { name: loanActions.handOver }).click();
  await expectToast(page, flash.loanHandedOver);
  await expect(loanStatusLabel(page, status.loan.out)).toBeVisible();
  await expectBadge(page, 0);
  await page.reload();
  await expectBadge(page, 0);
});

test("13 · the lender marks it as back", async () => {
  const page = as("lender");
  await page
    .getByLabel(loanActions.backOn, { exact: true })
    .fill(communityToday());
  await page
    .getByRole("radiogroup", { name: loanActions.asLentLegend })
    .getByRole("radio", { name: loanActions.asLentYes })
    .check();
  await page.getByRole("button", { name: loanActions.markBack }).click();
  await expectToast(page, flash.loanReturned);
  await expect(loanStatusLabel(page, status.loan.returned)).toBeVisible();
  await expectBadge(page, 0);
});

test("14 · the borrower sees the loan in Past and the item free", async () => {
  const page = as("borrower");
  const tag = currentTag();
  const title = itemTitle(tag);
  await page.goto("/my/loans?tab=borrowing");
  await expect(
    loanGroup(page, myLoans.groups.past).getByRole("heading", { name: title }),
  ).toBeVisible();

  await page.goto(`/items/${itemId}`);
  await expect(page.getByText(itemPage.nothingBooked)).toBeVisible();

  // "Free today" is a Browse card label; the item page has none.
  await page.goto(`/?q=${encodeURIComponent(tag)}`);
  await expect(
    main(page).getByRole("link", { name: title }).getByText(status.freeToday),
  ).toBeVisible();
});
