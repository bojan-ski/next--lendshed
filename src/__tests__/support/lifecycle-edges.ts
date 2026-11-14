import { readSource } from "@/__tests__/support/import-graph";
import type {
  InvitationState,
  ResetGrantState,
} from "@/__tests__/support/test-db";
import {
  ItemStatus,
  type LoanSystemReason,
  MemberStatus,
  Role,
} from "@/generated/prisma/enums";
import { loanStatus } from "@/lib/text/status";
import type { DailyJobStep } from "@/types/daily-job";

// Every edge of the five lifecycle diagrams in project-data.md → Workflows, with
// what drives it and the suites that prove it (spec 24). The diagrams are the
// source: stage-f/lifecycle-edges checks this registry against them, the
// actions inventory and the code.

export type Lifecycle =
  "loan" | "item" | "member" | "invitation" | "resetGrant" | "photo";

export type EdgeDriver =
  | { kind: "action"; action: string }
  | { kind: "auto"; reason: LoanSystemReason; actions: string[] }
  | { kind: "derived"; storedBy: DailyJobStep | null }
  | { kind: "job"; step: DailyJobStep }
  | { kind: "outbox"; actions: string[] };

// `from` is "none" for a creating edge; `to` is "gone" for a purge or a file removal.
export type LifecycleEdge = {
  lifecycle: Lifecycle;
  from: string;
  to: string;
  driver: EdgeDriver;
  coveredBy: string[];
};

export const NONE = "none";
export const GONE = "gone";

// Records, so a new member of the union fails to compile until it is listed.
const INVITATION: Record<InvitationState, true> = {
  open: true,
  used: true,
  revoked: true,
  expired: true,
};
const GRANT: Record<ResetGrantState, true> = {
  open: true,
  used: true,
  superseded: true,
  expired: true,
};

export const STATES: Record<Lifecycle, readonly string[]> = {
  loan: Object.keys(loanStatus),
  item: [...Object.values(ItemStatus), "deleted"],
  member: [...Object.values(MemberStatus), ...Object.values(Role), "deleted"],
  invitation: Object.keys(INVITATION),
  resetGrant: [...Object.keys(GRANT), "deleted"],
  photo: ["stored", "queued", GONE],
};

// Each "### " heading under Workflows that holds a ```text block, and the
// lifecycles it draws (invitation and reset grant share one block).
export const BLOCK_LIFECYCLES: Record<string, Lifecycle[]> = {
  "Loan Lifecycle": ["loan"],
  "Item Lifecycle": ["item"],
  "Member Lifecycle": ["member"],
  "Invitation and Reset-Grant Lifecycles": ["invitation", "resetGrant"],
  "Photo Pipeline": ["photo"],
};

export function workflowBlocks(
  document = readSource("context/project-data.md"),
): Record<string, string> {
  const section =
    document.split(/^## Workflows.*$/m)[1]?.split(/^## /m)[0] ?? "";
  const blocks: Record<string, string> = {};
  for (const chunk of section.split(/^### /m).slice(1)) {
    const heading = chunk.slice(0, chunk.indexOf("\n")).trim();
    const block = /```text\n([\s\S]*?)```/.exec(chunk)?.[1];
    if (block !== undefined) blocks[heading] = block;
  }
  return blocks;
}

// "stage-d/transition-matrix" → its consolidation suite; "data/items",
// "actions/loans", "lib/dates/effective-status" → the colocated test.
export function coveragePath(entry: string): string {
  return /^stage-[a-z]\//.test(entry)
    ? `src/__tests__/consolidation/${entry}.test.ts`
    : `src/${entry}.test.ts`;
}

// The words a covering file must contain at least one of.
export function driverTokens({ driver, to }: LifecycleEdge): string[] {
  switch (driver.kind) {
    case "action":
      return [driver.action];
    case "auto":
      return [driver.reason, ...driver.actions];
    case "derived":
      return driver.storedBy ? [to, driver.storedBy] : [to];
    case "job":
      return [driver.step];
    case "outbox":
      return [...driver.actions, "deletePendingBlobs"];
  }
}

type Pair = [from: string, to: string];

const byAction = (
  lifecycle: Lifecycle,
  pairs: Pair[],
  actions: string[],
  coveredBy: string[],
): LifecycleEdge[] =>
  pairs.flatMap(([from, to]) =>
    actions.map((action) => ({
      lifecycle,
      from,
      to,
      driver: { kind: "action" as const, action },
      coveredBy,
    })),
  );

const auto = (
  pairs: Pair[],
  reason: LoanSystemReason,
  actions: string[],
  coveredBy: string[],
): LifecycleEdge[] =>
  pairs.map(([from, to]) => ({
    lifecycle: "loan",
    from,
    to,
    driver: { kind: "auto", reason, actions },
    coveredBy,
  }));

const ACCOUNT_DELETION = ["deleteOwnAccount", "deleteMember"];
const LIVE_ITEM = ["hidden", "listed"];
const fromLiveItem = (to: string): Pair[] =>
  LIVE_ITEM.map((from) => [from, to]);

const LOAN_EDGES: LifecycleEdge[] = [
  ...byAction(
    "loan",
    [[NONE, "requested"]],
    ["requestLoan"],
    ["stage-d/stage-d-exit", "actions/loans"],
  ),
  ...byAction(
    "loan",
    [["requested", "approved"]],
    ["approveLoan"],
    ["stage-d/transition-matrix"],
  ),
  ...byAction(
    "loan",
    [["requested", "declined"]],
    ["declineLoan"],
    ["stage-d/transition-matrix"],
  ),
  ...byAction(
    "loan",
    [
      ["requested", "cancelled"],
      ["approved", "cancelled"],
    ],
    ["cancelLoan"],
    ["stage-d/transition-matrix"],
  ),
  ...byAction(
    "loan",
    [["approved", "out"]],
    ["markLoanOut"],
    ["stage-d/transition-matrix", "stage-d/stage-d-exit"],
  ),
  ...byAction(
    "loan",
    [
      ["out", "returned"],
      ["overdue", "returned"],
    ],
    ["markLoanReturned", "closeLoanAsOrganizer"],
    ["stage-d/transition-matrix"],
  ),
  ...auto(
    [["requested", "declined"]],
    "dates_taken",
    ["approveLoan"],
    ["data/loan-transitions", "stage-d/stale-screen"],
  ),
  ...auto(
    [["requested", "declined"]],
    "item_hidden",
    ["hideItem"],
    ["data/items", "stage-f/item-transition-matrix"],
  ),
  ...auto(
    [["requested", "declined"]],
    "item_retired",
    ["retireOwnItem", "retireItemAsOrganizer"],
    ["data/items", "stage-f/item-transition-matrix"],
  ),
  ...auto(
    [["approved", "cancelled"]],
    "item_retired",
    ["retireItemAsOrganizer"],
    ["data/items", "stage-e/stage-e-exit"],
  ),
  ...auto(
    [
      ["requested", "declined"],
      ["approved", "cancelled"],
    ],
    "owner_suspended",
    ["suspendMember"],
    ["stage-e/side-effect-matrix"],
  ),
  ...auto(
    [
      ["requested", "cancelled"],
      ["approved", "cancelled"],
    ],
    "borrower_suspended",
    ["suspendMember"],
    ["stage-e/side-effect-matrix"],
  ),
  ...auto(
    [
      ["requested", "declined"],
      ["requested", "cancelled"],
      ["approved", "cancelled"],
    ],
    "account_deleted",
    ACCOUNT_DELETION,
    ["stage-e/side-effect-matrix", "data/members"],
  ),
  {
    lifecycle: "loan",
    from: "requested",
    to: "expired",
    driver: { kind: "derived", storedBy: "storeExpired" },
    coveredBy: ["lib/dates/effective-status", "stage-e/job-catch-up"],
  },
  {
    lifecycle: "loan",
    from: "approved",
    to: "lapsed",
    driver: { kind: "derived", storedBy: "storeLapsed" },
    coveredBy: ["lib/dates/effective-status", "stage-e/job-catch-up"],
  },
  {
    lifecycle: "loan",
    from: "out",
    to: "overdue",
    driver: { kind: "derived", storedBy: null },
    coveredBy: ["lib/dates/effective-status", "stage-d/transition-matrix"],
  },
];

const ITEM_EDGES: LifecycleEdge[] = [
  ...byAction(
    "item",
    [[NONE, "hidden"]],
    ["createItem"],
    ["actions/items", "stage-c/cap-refusals"],
  ),
  ...byAction(
    "item",
    [["hidden", "listed"]],
    ["listItem"],
    ["stage-f/item-transition-matrix", "data/items"],
  ),
  ...byAction(
    "item",
    [["listed", "hidden"]],
    ["hideItem"],
    ["stage-f/item-transition-matrix", "data/items"],
  ),
  ...byAction(
    "item",
    fromLiveItem("retired"),
    ["retireOwnItem"],
    ["stage-f/item-transition-matrix", "data/items"],
  ),
  ...byAction(
    "item",
    fromLiveItem("retired"),
    ["retireItemAsOrganizer"],
    ["data/items", "stage-e/organizer-guard-matrix"],
  ),
  // Items with loan rows are retired, never-lent ones deleted.
  ...byAction("item", fromLiveItem("retired"), ACCOUNT_DELETION, [
    "stage-e/side-effect-matrix",
  ]),
  ...byAction(
    "item",
    fromLiveItem("deleted"),
    ["deleteItem"],
    ["stage-f/item-transition-matrix", "data/items"],
  ),
  ...byAction("item", fromLiveItem("deleted"), ACCOUNT_DELETION, [
    "stage-e/side-effect-matrix",
  ]),
];

const MEMBER_EDGES: LifecycleEdge[] = [
  ...byAction(
    "member",
    [[NONE, "active"]],
    ["joinWithInvitation"],
    ["data/invitations", "actions/invitations"],
  ),
  ...byAction(
    "member",
    [["active", "suspended"]],
    ["suspendMember"],
    ["stage-f/member-transition-matrix", "actions/members"],
  ),
  ...byAction(
    "member",
    [["suspended", "active"]],
    ["reinstateMember"],
    ["stage-f/member-transition-matrix", "actions/members"],
  ),
  ...byAction(
    "member",
    [["member", "organizer"]],
    ["promoteMember"],
    ["stage-f/member-transition-matrix", "data/members"],
  ),
  ...byAction(
    "member",
    [["organizer", "member"]],
    ["demoteMember"],
    ["stage-f/member-transition-matrix", "data/members"],
  ),
  ...byAction(
    "member",
    [["active", "deleted"]],
    ["deleteOwnAccount"],
    ["actions/account", "data/members"],
  ),
  ...byAction(
    "member",
    [["suspended", "deleted"]],
    ["deleteMember"],
    ["stage-f/member-transition-matrix", "actions/members"],
  ),
];

const INVITATION_EDGES: LifecycleEdge[] = [
  ...byAction(
    "invitation",
    [[NONE, "open"]],
    ["createInvitation"],
    ["actions/invitations", "data/invitations"],
  ),
  ...byAction(
    "invitation",
    [["open", "used"]],
    ["joinWithInvitation"],
    ["data/invitations", "stage-b/stage-b-exit"],
  ),
  ...byAction(
    "invitation",
    [["open", "revoked"]],
    ["revokeInvitation"],
    ["actions/invitations", "data/invitations"],
  ),
  // Of its organizer.
  ...byAction(
    "invitation",
    [["open", "revoked"]],
    ["suspendMember", ...ACCOUNT_DELETION],
    ["stage-e/side-effect-matrix", "data/members"],
  ),
  {
    lifecycle: "invitation",
    from: "open",
    to: "expired",
    driver: { kind: "derived", storedBy: null },
    coveredBy: ["stage-b/token-flows", "data/daily-job"],
  },
  {
    lifecycle: "invitation",
    from: "expired",
    to: GONE,
    driver: { kind: "job", step: "purgeInvitations" },
    coveredBy: ["data/daily-job"],
  },
];

const RESET_GRANT_EDGES: LifecycleEdge[] = [
  ...byAction(
    "resetGrant",
    [
      [NONE, "open"],
      ["open", "superseded"],
    ],
    ["createResetLink"],
    ["actions/members", "data/reset-grants"],
  ),
  ...byAction(
    "resetGrant",
    [["open", "used"]],
    ["resetPasswordWithGrant"],
    ["data/reset-grants", "stage-b/stage-b-exit"],
  ),
  // Of its member.
  ...byAction("resetGrant", [["open", "deleted"]], ACCOUNT_DELETION, [
    "stage-e/side-effect-matrix",
  ]),
  {
    lifecycle: "resetGrant",
    from: "open",
    to: "expired",
    driver: { kind: "derived", storedBy: null },
    coveredBy: ["stage-b/token-flows", "data/daily-job"],
  },
  {
    lifecycle: "resetGrant",
    from: "expired",
    to: GONE,
    driver: { kind: "job", step: "purgeResetGrants" },
    coveredBy: ["data/daily-job"],
  },
];

const PHOTO_REMOVERS = [
  "retireOwnItem",
  "deleteItem",
  "retireItemAsOrganizer",
  ...ACCOUNT_DELETION,
];

const PHOTO_EDGES: LifecycleEdge[] = [
  // Caps, decode, WebP, upload log + reservation.
  ...byAction(
    "photo",
    [[NONE, "stored"]],
    ["uploadItemPhoto"],
    ["actions/photos", "stage-c/cap-refusals"],
  ),
  // The replaced key.
  ...byAction(
    "photo",
    [["stored", "queued"]],
    ["uploadItemPhoto"],
    ["data/photos", "actions/photos"],
  ),
  {
    lifecycle: "photo",
    from: "stored",
    to: "queued",
    driver: { kind: "outbox", actions: PHOTO_REMOVERS },
    coveredBy: ["data/items", "data/members", "stage-f/item-transition-matrix"],
  },
  // After commit; a failure stays queued (attempts + 1).
  {
    lifecycle: "photo",
    from: "queued",
    to: GONE,
    driver: {
      kind: "outbox",
      actions: ["uploadItemPhoto", ...PHOTO_REMOVERS],
    },
    coveredBy: ["data/blob-deletions", "stage-e/workflow-atomicity"],
  },
  {
    lifecycle: "photo",
    from: "queued",
    to: GONE,
    driver: { kind: "job", step: "retryBlobDeletions" },
    coveredBy: ["data/daily-job", "stage-e/job-catch-up"],
  },
];

export const LIFECYCLE_EDGES: LifecycleEdge[] = [
  ...LOAN_EDGES,
  ...ITEM_EDGES,
  ...MEMBER_EDGES,
  ...INVITATION_EDGES,
  ...RESET_GRANT_EDGES,
  ...PHOTO_EDGES,
];

// What each action fires on success, and only then (spec 24, from the inventory).
export type RenderSignal =
  "updateTag" | "refresh" | "flashRedirect" | "redirect" | "none";

export const RENDER_SIGNALS: Record<string, RenderSignal> = {
  createCategory: "updateTag",
  renameCategory: "updateTag",
  deleteCategory: "updateTag",
  updateProfile: "refresh",
  updateContactDetails: "refresh",
  updateItem: "refresh",
  uploadItemPhoto: "refresh",
  listItem: "refresh",
  hideItem: "refresh",
  retireOwnItem: "refresh",
  approveLoan: "refresh",
  declineLoan: "refresh",
  cancelLoan: "refresh",
  markLoanOut: "refresh",
  markLoanReturned: "refresh",
  closeLoanAsOrganizer: "refresh",
  createInvitation: "refresh",
  revokeInvitation: "refresh",
  suspendMember: "refresh",
  reinstateMember: "refresh",
  promoteMember: "refresh",
  demoteMember: "refresh",
  joinWithInvitation: "flashRedirect",
  resetPasswordWithGrant: "flashRedirect",
  deleteOwnAccount: "flashRedirect",
  createItem: "flashRedirect",
  deleteItem: "flashRedirect",
  retireItemAsOrganizer: "flashRedirect",
  requestLoan: "flashRedirect",
  deleteMember: "flashRedirect",
  signIn: "redirect",
  signOut: "redirect",
  // The library's new session cookie re-renders the route.
  changePassword: "none",
  // Nothing on the page shows grants.
  createResetLink: "none",
};
