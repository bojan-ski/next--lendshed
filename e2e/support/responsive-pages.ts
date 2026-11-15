import { account } from "@/strings/account";
import { categories } from "@/strings/categories";
import { invitations } from "@/strings/invitations";
import { items } from "@/strings/items";
import { join } from "@/strings/join";
import { login } from "@/strings/login";
import { myLoans } from "@/strings/myLoans";
import { resetPassword } from "@/strings/resetPassword";

// The 360 px sweep's pages (spec 25). No Playwright or Prisma import: Vitest's
// stage-f/accessibility-static checks this list against the route tree.

export type Persona = "guest" | "member" | "organizer";

export type ResponsivePage = {
  pattern: string;
  persona: Persona;
  // A Playwright selector for something only the resolved page renders, never
  // its Suspense skeleton (skeletons have no headings, controls or tables).
  ready: string;
};

const button = (name: string) => `role=button[name="${name}"]`;
const H1 = "role=heading[level=1]";
const text = (value: string) => `css=main :text-is("${value}")`;
const tableOrEmpty = (heading: string) =>
  `css=main table, main :text-is("${heading}")`;

export const RESPONSIVE_PAGES: ResponsivePage[] = [
  { pattern: "/login", persona: "guest", ready: button(login.submit) },
  { pattern: "/invite/[token]", persona: "guest", ready: button(join.submit) },
  {
    pattern: "/reset/[token]",
    persona: "guest",
    ready: button(resetPassword.submit),
  },
  // No Suspense on these three: the page's own h1 is the resolved page.
  { pattern: "/house-rules", persona: "guest", ready: H1 },
  { pattern: "/privacy", persona: "guest", ready: H1 },
  { pattern: "/", persona: "member", ready: "role=search" },
  // The h1 of these five sits inside the streamed section.
  { pattern: "/items/[id]", persona: "member", ready: H1 },
  { pattern: "/members/[id]", persona: "member", ready: H1 },
  { pattern: "/my/items/[id]/edit", persona: "member", ready: H1 },
  { pattern: "/loans/[id]", persona: "organizer", ready: H1 },
  { pattern: "/admin/members/[id]", persona: "organizer", ready: H1 },
  {
    pattern: "/my/items",
    persona: "member",
    ready: `role=link[name="${items.addItem}"]`,
  },
  {
    pattern: "/my/items/new",
    persona: "member",
    ready: text(items.stepDetails),
  },
  {
    pattern: "/my/loans",
    persona: "member",
    ready: `role=navigation[name="${myLoans.tabsLabel}"]`,
  },
  {
    pattern: "/account",
    persona: "member",
    ready: `role=heading[name="${account.profileHeading}"]`,
  },
  { pattern: "/admin", persona: "organizer", ready: H1 },
  {
    pattern: "/admin/invitations",
    persona: "organizer",
    ready: tableOrEmpty(invitations.emptyHeading),
  },
  {
    pattern: "/admin/members",
    persona: "organizer",
    ready: "css=main [role=status]",
  },
  {
    pattern: "/admin/categories",
    persona: "organizer",
    ready: tableOrEmpty(categories.emptyHeading),
  },
  { pattern: "/admin/usage", persona: "organizer", ready: "role=meter" },
];
