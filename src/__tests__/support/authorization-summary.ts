import { readSource, sourceFiles } from "@/__tests__/support/import-graph";
import { coveragePath } from "@/__tests__/support/lifecycle-edges";

// The overview's Authorization Summary (spec 25). The table is the source: each
// entry only places a row's surfaces and names the suites that prove it, and
// stage-f/authorization-summary checks both against the code.

export type SummaryColumn = "guest" | "member" | "organizer";
export const SUMMARY_COLUMNS: SummaryColumn[] = [
  "guest",
  "member",
  "organizer",
];

export type CellOutcome = "allowed" | "refused" | "party" | "bearer" | "none";

const PARTY =
  /^item owner$|^borrower$|^owner or borrower$|^owner\/borrower of |only as a party/i;

export function cellOutcome(cell: string): CellOutcome {
  if (/^Yes( \(.+\))?$/.test(cell)) return "allowed";
  if (cell === "No") return "refused";
  if (cell === "—") return "none";
  if (cell.includes("bearer")) return "bearer";
  if (PARTY.test(cell)) return "party";
  throw new Error(`Unclassified Summary cell: "${cell}"`);
}

export type SummaryRow = {
  feature: string;
  cells: Record<SummaryColumn, string>;
};

// The rows of the table under "## Authorization Summary"; a cell's own `\|` is
// text, not a column break.
export function summaryRows(
  document = readSource("context/project-overview.md"),
): SummaryRow[] {
  const section =
    document.split(/^## Authorization Summary.*$/m)[1]?.split(/^## /m)[0] ?? "";
  const lines = section.split("\n").filter((line) => line.startsWith("|"));
  return lines.slice(2).map((line) => {
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim().replaceAll("\\|", "|"));
    if (cells.length !== 4) {
      throw new Error(`Summary row without four cells: ${line}`);
    }
    const [feature, guest, member, organizer] = cells;
    return { feature, cells: { guest, member, organizer } };
  });
}

export const LEADING_ROLE_OUTCOMES: Record<
  string,
  Record<SummaryColumn, CellOutcome>
> = {
  public: { guest: "allowed", member: "allowed", organizer: "allowed" },
  "public (token)": {
    guest: "allowed",
    member: "allowed",
    organizer: "allowed",
  },
  member: { guest: "refused", member: "allowed", organizer: "allowed" },
  "member (self)": {
    guest: "refused",
    member: "allowed",
    organizer: "allowed",
  },
  owner: { guest: "refused", member: "allowed", organizer: "allowed" },
  "item owner": { guest: "refused", member: "party", organizer: "party" },
  "borrower (requested/approved) or owner (approved)": {
    guest: "refused",
    member: "party",
    organizer: "party",
  },
  organizer: { guest: "refused", member: "refused", organizer: "allowed" },
};

export type HandlerFile = { path: string; file: string };

// Every route handler by its URL path: each route.ts, plus the robots metadata route.
export function handlerFiles(): HandlerFile[] {
  const routes = sourceFiles("src/app/**/route.ts").map((file) => ({
    file,
    path:
      file
        .replace(/^src\/app/, "")
        .replace(/\/\([^/]+\)/g, "")
        .replace(/\/route\.ts$/, "") || "/",
  }));
  const robots = sourceFiles("src/app/robots.ts").map((file) => ({
    file,
    path: "/robots.txt",
  }));
  return [...routes, ...robots].sort((a, b) => a.path.localeCompare(b.path));
}

export const routeHandlers = (): string[] =>
  handlerFiles().map(({ path }) => path);

export type AuthorizationEntry = {
  feature: string;
  actions: string[];
  pages: string[];
  sections: { page: string; component: string }[];
  handlers: string[];
  reads: string[];
  coveredBy: { file: string; token: string }[];
};

// "stage-a/action-enforcement", "actions/loans", "app/robots" → the test file.
const claims = (pairs: [entry: string, token: string][]) =>
  pairs.map(([entry, token]) => ({ file: coveragePath(entry), token }));

const entry = (
  feature: string,
  surfaces: Partial<Omit<AuthorizationEntry, "feature" | "coveredBy">>,
  coveredBy: [entry: string, token: string][],
): AuthorizationEntry => ({
  feature,
  actions: [],
  pages: [],
  sections: [],
  handlers: [],
  reads: [],
  ...surfaces,
  coveredBy: claims(coveredBy),
});

const LOAN_ACTIONS = { page: "/loans/[id]", component: "LoanActionsCard" };

export const AUTHORIZATION_SUMMARY: AuthorizationEntry[] = [
  entry(
    "Sign in; open invite/reset link; House rules, Privacy",
    {
      actions: ["signIn", "joinWithInvitation", "resetPasswordWithGrant"],
      pages: [
        "/login",
        "/invite/[token]",
        "/reset/[token]",
        "/house-rules",
        "/privacy",
      ],
      handlers: ["/api/auth/[...all]", "/robots.txt"],
    },
    [
      ["stage-a/action-enforcement", "signIn"],
      ["stage-a/signed-out-no-session", "/login"],
      ["stage-a/route-guard-matrix", "routePattern("],
      ["stage-b/token-flows", "joinWithInvitation"],
      ["app/api/auth/[...all]/route", "./route"],
      ["app/robots", "./robots"],
    ],
  ),
  entry(
    "Browse, item pages, public profiles",
    {
      pages: ["/", "/items/[id]", "/members/[id]"],
      reads: ["getBrowseItems", "getItemForViewer", "getMemberProfile"],
    },
    [
      ["stage-a/route-guard-matrix", "routePattern("],
      ["stage-c/visibility-scope", "getItemForViewer"],
      ["data/browse", "getBrowseItems"],
    ],
  ),
  entry(
    "Create/edit/list/hide/retire/delete **own** items",
    {
      actions: [
        "createItem",
        "updateItem",
        "uploadItemPhoto",
        "listItem",
        "hideItem",
        "retireOwnItem",
        "deleteItem",
      ],
      pages: ["/my/items", "/my/items/new", "/my/items/[id]/edit"],
      sections: [{ page: "/items/[id]", component: "ItemDetailSection" }],
    },
    [
      ["stage-a/action-enforcement", "createItem"],
      ["stage-c/owner-guards", "createItem"],
      ["actions/items", "createItem"],
      ["actions/photos", "uploadItemPhoto"],
      ["stage-f/item-page-offers", "ItemDetailSection"],
    ],
  ),
  entry(
    "Retire **any** item (required note; cancels approved loans, refused while one is `out`, OQ-35)",
    {
      actions: ["retireItemAsOrganizer"],
      sections: [{ page: "/items/[id]", component: "OrganizerRetireCard" }],
      reads: ["getItemForViewer"],
    },
    [
      ["stage-a/action-enforcement", "retireItemAsOrganizer"],
      ["stage-e/organizer-guard-matrix", "retireItemAsOrganizer"],
      ["data/browse", "getItemForViewer"],
      ["stage-f/item-page-offers", "OrganizerRetireCard"],
    ],
  ),
  entry(
    "Request a loan (not own item)",
    {
      actions: ["requestLoan"],
      sections: [{ page: "/items/[id]", component: "RequestCard" }],
      reads: ["getItemForViewer"],
    },
    [
      ["actions/loans", "requestLoan"],
      ["data/loans", "getItemForViewer"],
      ["stage-c/sections-render", "getItemForViewer"],
      ["stage-f/item-page-offers", "RequestCard"],
    ],
  ),
  entry(
    "Approve/decline a request; hand over; mark as back",
    {
      actions: [
        "approveLoan",
        "declineLoan",
        "markLoanOut",
        "markLoanReturned",
      ],
      pages: ["/my/loans"],
      sections: [LOAN_ACTIONS],
      reads: ["getMyLoans"],
    },
    [
      ["stage-d/transition-matrix", "approveLoan"],
      ["actions/loans", "approveLoan"],
      ["actions/loan-handover", "markLoanOut"],
      ["stage-c/visibility-scope", "getMyLoans"],
    ],
  ),
  entry(
    "Cancel a request",
    { actions: ["cancelLoan"], pages: ["/my/loans"], sections: [LOAN_ACTIONS] },
    [
      ["stage-d/transition-matrix", "cancelLoan"],
      ["actions/loans", "cancelLoan"],
    ],
  ),
  entry(
    "Cancel an approved loan",
    { actions: ["cancelLoan"], pages: ["/my/loans"], sections: [LOAN_ACTIONS] },
    [
      ["stage-d/transition-matrix", "cancelLoan"],
      ["actions/loans", "cancelLoan"],
    ],
  ),
  entry(
    "Close any `out` loan (organizer close)",
    { actions: ["closeLoanAsOrganizer"], sections: [LOAN_ACTIONS] },
    [
      ["stage-d/transition-matrix", "closeLoanAsOrganizer"],
      ["stage-e/organizer-guard-matrix", "closeLoanAsOrganizer"],
      ["actions/loans", "closeLoanAsOrganizer"],
    ],
  ),
  entry(
    "View `/loans/[id]`",
    { pages: ["/loans/[id]"], reads: ["getLoanForViewer"] },
    [
      ["stage-c/visibility-scope", "LoanDetailSection"],
      ["data/loans", "getLoanForViewer"],
      ["app/(app)/loans/[id]/page", "getLoanForViewer"],
      ["stage-a/route-guard-matrix", "routePattern("],
    ],
  ),
  entry(
    "See contact details on a loan",
    {
      sections: [{ page: "/loans/[id]", component: "LoanContactCard" }],
      reads: ["getLoanForViewer"],
    },
    [["data/loans", "getLoanForViewer"]],
  ),
  entry(
    "Edit own profile/contact details/password; sign out; delete own account",
    {
      actions: [
        "updateProfile",
        "updateContactDetails",
        "changePassword",
        "signOut",
        "deleteOwnAccount",
      ],
      pages: ["/account"],
    },
    [
      ["stage-a/action-enforcement", "updateProfile"],
      ["actions/account", "updateProfile"],
      ["actions/auth", "signOut"],
      ["stage-e/organizer-guard-matrix", "deleteOwnAccount"],
      ["stage-f/authorization-summary", "inventoryRows("],
    ],
  ),
  entry(
    "Invitations: create, list, revoke",
    {
      actions: ["createInvitation", "revokeInvitation"],
      pages: ["/admin/invitations", "/admin"],
      reads: ["getOpenInvitations"],
    },
    [
      ["stage-a/action-enforcement", "createInvitation"],
      ["stage-b/admin-guard", "getOpenInvitations"],
      ["actions/invitations", "createInvitation"],
    ],
  ),
  entry(
    "Members: list, detail, suspend, reinstate, promote, demote, reset link",
    {
      actions: [
        "suspendMember",
        "reinstateMember",
        "promoteMember",
        "demoteMember",
        "createResetLink",
      ],
      pages: ["/admin/members", "/admin/members/[id]", "/admin"],
      reads: ["getAdminMembers", "getAdminMemberDetail"],
    },
    [
      ["stage-a/action-enforcement", "suspendMember"],
      ["stage-b/organizer-guards", "suspendMember"],
      ["stage-e/organizer-guard-matrix", "suspendMember"],
      ["stage-b/admin-guard", "getAdminMembers"],
      ["actions/members", "suspendMember"],
    ],
  ),
  entry(
    "Delete a member",
    {
      actions: ["deleteMember"],
      sections: [
        { page: "/admin/members/[id]", component: "DeleteMemberButton" },
      ],
    },
    [
      ["stage-e/organizer-guard-matrix", "deleteMember"],
      ["actions/members", "deleteMember"],
    ],
  ),
  entry(
    "Categories: add, rename, delete unused",
    {
      actions: ["createCategory", "renameCategory", "deleteCategory"],
      pages: ["/admin/categories", "/admin"],
      reads: ["getAdminCategories"],
    },
    [
      ["stage-a/action-enforcement", "createCategory"],
      ["stage-b/admin-guard", "getAdminCategories"],
      ["actions/categories", "createCategory"],
    ],
  ),
  entry(
    "Usage panel",
    { pages: ["/admin/usage", "/admin"], reads: ["getUsage"] },
    [
      ["stage-b/admin-guard", "getUsage"],
      ["stage-a/route-guard-matrix", "routePattern("],
    ],
  ),
  entry(
    "Daily job endpoint",
    { handlers: ["/api/cron/daily"], reads: ["runDailyJob"] },
    [["app/api/cron/daily/route", "./route"]],
  ),
];
