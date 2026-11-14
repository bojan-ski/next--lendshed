import { refresh } from "next/cache";
import { createElement } from "react";
import {
  inventoryRows,
  leadingRole,
  serverActionExports,
} from "@/__tests__/support/action-inventory";
import { readSource } from "@/__tests__/support/import-graph";
import { loanRow } from "@/__tests__/support/loan-fixtures";
import { memberFootprint, viewerOf } from "@/__tests__/support/member-fixtures";
import { mockNextRequest } from "@/__tests__/support/next-request";
import { html } from "@/__tests__/support/prerender-html";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { deleteOwnAccount } from "@/actions/account";
import { createInvitation } from "@/actions/invitations";
import { retireItemAsOrganizer } from "@/actions/items";
import { closeLoanAsOrganizer } from "@/actions/loans";
import {
  createResetLink,
  deleteMember,
  demoteMember,
  promoteMember,
  reinstateMember,
  suspendMember,
} from "@/actions/members";
import AccountSections from "@/components/account/AccountSections";
import MemberDetailSection from "@/components/members/MemberDetailSection";
import { getAccount } from "@/data/account";
import {
  changeMemberRole,
  deleteMemberAccount,
  deleteOwnUser,
  getAdminMemberDetail,
  reinstateMemberAccount,
  suspendMemberAccount,
  toAdminMemberDetailDTO,
} from "@/data/members";
import { insertResetGrant } from "@/data/reset-grants";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import type { MemberStatus, Role } from "@/generated/prisma/enums";
import { addDays, communityToday } from "@/lib/dates/dates";
import { setFlash } from "@/lib/feedback/flash";
import type { AccountDTO } from "@/types/account";
import type { EffectiveLoanStatus } from "@/types/loan";
import type { AdminMemberOpenLoan } from "@/types/members";
import type { ViewerDTO } from "@/types/viewer";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/feedback/flash", () => ({ setFlash: vi.fn() }));
vi.mock("@/lib/feedback/report", () => ({ reportUnexpected: vi.fn() }));
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/members")>();
  return {
    ...actual,
    changeMemberRole: vi.fn(actual.changeMemberRole),
    suspendMemberAccount: vi.fn(actual.suspendMemberAccount),
    reinstateMemberAccount: vi.fn(actual.reinstateMemberAccount),
    deleteMemberAccount: vi.fn(actual.deleteMemberAccount),
    deleteOwnUser: vi.fn(actual.deleteOwnUser),
    getAdminMemberDetail: vi.fn(actual.getAdminMemberDetail),
  };
});
vi.mock("@/data/reset-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/reset-grants")>();
  return { ...actual, insertResetGrant: vi.fn(actual.insertResetGrant) };
});
vi.mock("@/data/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/account")>();
  return { ...actual, getAccount: vi.fn(actual.getAccount) };
});
// Each island renders a marker naming the action it would post to.
vi.mock("@/components/members/MemberStatusControl", () => ({
  default: ({ change }: { change: string }) =>
    createElement("i", { "data-offer": `${change}Member` }),
}));
vi.mock("@/components/members/RoleChangeButton", () => ({
  default: ({ change }: { change: string }) =>
    createElement("i", { "data-offer": `${change}Member` }),
}));
vi.mock("@/components/members/DeleteMemberButton", () => ({
  default: () => createElement("i", { "data-offer": "deleteMember" }),
}));
vi.mock("@/components/members/ResetLinkForm", () => ({
  default: () => createElement("i", { "data-offer": "createResetLink" }),
}));
vi.mock("@/components/account/DeleteAccountButton", () => ({
  default: () => createElement("i", { "data-offer": "deleteOwnAccount" }),
}));
vi.mock("@/components/members/MemberOpenLoans", () => ({
  default: () => null,
}));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// Every organizer action against the three guards a page can't enforce:
// never yourself, the actor re-checked under the organizer locks, and never
// the last active organizer. Then "offered on the page ⇔ accepted by the
// action". The sets are derived from project-data.md's Auth column, so a new
// action joins its column by the words of its row.

const scope = createTestScope();
const TODAY = communityToday();

type Action = (prev: never, formData: FormData) => Promise<unknown>;
const ACTIONS: Record<string, Action> = {
  createInvitation,
  createResetLink,
  promoteMember,
  demoteMember,
  suspendMember,
  reinstateMember,
  deleteMember,
  closeLoanAsOrganizer,
  retireItemAsOrganizer,
  deleteOwnAccount,
} as Record<string, Action>;

const inCode = new Set(serverActionExports().map(({ name }) => name));
const rows = inventoryRows().filter(({ name }) => inCode.has(name));
const organizerOnly = rows
  .filter(({ auth }) => leadingRole(auth) === "organizer")
  .map(({ name }) => name)
  .sort();
const notSelf = rows
  .filter(({ auth }) => auth.includes("not self"))
  .map(({ name }) => name)
  .sort();
const actorRechecked = rows
  .filter(({ auth }) =>
    auth.includes("actor re-checked among the locked active organizers"),
  )
  .map(({ name }) => name)
  .sort();
// "not the last active organizer", or "demote not the last…" for the one
// action of a shared row the clause names.
const lastOrganizerGuarded = rows
  .filter(({ name, auth }) =>
    auth.split(";").some((clause) => {
      const match = /^(?:(\w+) )?not the last active organizer$/.exec(
        clause.trim(),
      );
      return match !== null && (!match[1] || name.startsWith(match[1]));
    }),
  )
  .map(({ name }) => name)
  .sort();

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function call(name: string, viewer: ViewerDTO, data: FormData) {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  return ACTIONS[name]({} as never, data) as Promise<Record<string, unknown>>;
}

let organizer: ViewerDTO;
let member: ViewerDTO;
let borrower: ViewerDTO;

beforeAll(async () => {
  await assertMigrated();
  mockNextRequest();
  const [org, own, other] = await Promise.all([
    scope.createTestUser({ name: "Ruth K.", role: "organizer" }),
    scope.createTestUser({ name: "Olga M.", contactDetails: "Phone 1" }),
    scope.createTestUser({ name: "Bora P.", contactDetails: "Phone 2" }),
  ]);
  organizer = viewerOf(org.id, "organizer");
  member = viewerOf(own.id);
  borrower = viewerOf(other.id);
});
afterAll(() => scope.cleanup());

describe("the derived sets", () => {
  test("13 organizer-only actions", () => {
    expect(organizerOnly).toEqual(
      [
        "closeLoanAsOrganizer",
        "createCategory",
        "createInvitation",
        "createResetLink",
        "deleteCategory",
        "deleteMember",
        "demoteMember",
        "promoteMember",
        "reinstateMember",
        "renameCategory",
        "retireItemAsOrganizer",
        "revokeInvitation",
        "suspendMember",
      ].sort(),
    );
  });

  test("6 never-self, 9 actor re-checked, 3 last-organizer guarded", () => {
    expect(notSelf).toEqual(
      [
        "createResetLink",
        "deleteMember",
        "demoteMember",
        "promoteMember",
        "reinstateMember",
        "suspendMember",
      ].sort(),
    );
    expect(actorRechecked).toEqual(
      [
        "closeLoanAsOrganizer",
        "createInvitation",
        "createResetLink",
        "deleteMember",
        "demoteMember",
        "promoteMember",
        "reinstateMember",
        "retireItemAsOrganizer",
        "suspendMember",
      ].sort(),
    );
    expect(lastOrganizerGuarded).toEqual(
      ["deleteOwnAccount", "demoteMember", "suspendMember"].sort(),
    );
  });

  test("the organizer-only actions without an actor re-check are the category and revoke actions", () => {
    expect(
      organizerOnly.filter((name) => !actorRechecked.includes(name)),
    ).toEqual([
      "createCategory",
      "deleteCategory",
      "renameCategory",
      "revokeInvitation",
    ]);
  });
});

describe("(a) never yourself", () => {
  const DATA_FUNCTION: Record<string, () => unknown> = {
    createResetLink: () => insertResetGrant,
    promoteMember: () => changeMemberRole,
    demoteMember: () => changeMemberRole,
    suspendMember: () => suspendMemberAccount,
    reinstateMember: () => reinstateMemberAccount,
    deleteMember: () => deleteMemberAccount,
  };

  test("every never-self action is covered here", () => {
    expect(Object.keys(DATA_FUNCTION).sort()).toEqual(notSelf);
  });

  test.each(notSelf)(
    "%s on your own id → self, nothing read or written",
    async (name) => {
      const before = await memberFootprint(organizer.id);
      const state = await call(name, organizer, form({ id: organizer.id }));
      expect(state).toEqual({ formError: "self" });
      expect(DATA_FUNCTION[name]()).not.toHaveBeenCalled();
      expect(await memberFootprint(organizer.id)).toEqual(before);
      expect(refresh).not.toHaveBeenCalled();
      expect(setFlash).not.toHaveBeenCalled();
    },
  );

  test("closeLoanAsOrganizer on a loan you borrow → stale, nothing written", async () => {
    const item = await scope.createItem({
      ownerId: member.id,
      status: "listed",
    });
    const { id } = await scope.createLoan({
      itemId: item.id,
      borrowerId: organizer.id,
      status: "out",
      startDate: addDays(TODAY, -1),
      endDate: addDays(TODAY, 1),
    });
    const before = await loanRow(id);
    const state = await call(
      "closeLoanAsOrganizer",
      organizer,
      form({ id, returnedOn: TODAY, asLent: "yes", note: "Closed" }),
    );
    expect(state).toMatchObject({ formError: "stale" });
    expect(await loanRow(id)).toEqual(before);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("retireItemAsOrganizer on your own item → stale, nothing written", async () => {
    const { id } = await scope.createItem({
      ownerId: organizer.id,
      status: "listed",
    });
    const before = await db.item.findUniqueOrThrow({ where: { id } });
    const state = await call(
      "retireItemAsOrganizer",
      organizer,
      form({ id, note: "Broken" }),
    );
    expect(state).toMatchObject({ formError: "stale" });
    expect(await db.item.findUniqueOrThrow({ where: { id } })).toEqual(before);
    expect(setFlash).not.toHaveBeenCalled();
  });
});

describe("(b) the actor re-checked among the locked active organizers", () => {
  // The viewer still says organizer; the database no longer does.
  const actors: Record<string, ViewerDTO> = {};
  const cases: Record<
    string,
    { form: () => FormData; state: () => Promise<unknown> }
  > = {};

  beforeAll(async () => {
    const [demoted, suspended, target, targetOrganizer, suspendedTarget] =
      await Promise.all([
        scope.createTestUser({ name: "Dee D." }),
        scope.createTestUser({
          name: "Sue S.",
          role: "organizer",
          status: "suspended",
        }),
        scope.createTestUser({ name: "Tom T." }),
        scope.createTestUser({ name: "Ola O.", role: "organizer" }),
        scope.createTestUser({ name: "Sid S.", status: "suspended" }),
      ]);
    actors.demoted = viewerOf(demoted.id, "organizer");
    actors.suspended = viewerOf(suspended.id, "organizer");
    const outItem = await scope.createItem({
      ownerId: member.id,
      status: "listed",
    });
    const out = await scope.createLoan({
      itemId: outItem.id,
      borrowerId: borrower.id,
      status: "out",
      startDate: addDays(TODAY, -1),
      endDate: addDays(TODAY, 1),
    });
    const retireItem = await scope.createItem({
      ownerId: member.id,
      status: "listed",
    });
    const user = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
    const actorRows = () =>
      Promise.all([
        db.invitation.count({
          where: { createdById: { in: [demoted.id, suspended.id] } },
        }),
        db.passwordResetGrant.count({ where: { userId: target.id } }),
      ]);

    cases.createInvitation = { form: () => form({}), state: actorRows };
    cases.createResetLink = {
      form: () => form({ id: target.id }),
      state: actorRows,
    };
    cases.promoteMember = {
      form: () => form({ id: target.id }),
      state: () => user(target.id),
    };
    cases.demoteMember = {
      form: () => form({ id: targetOrganizer.id }),
      state: () => user(targetOrganizer.id),
    };
    cases.suspendMember = {
      form: () => form({ id: target.id }),
      state: () => memberFootprint(target.id),
    };
    cases.reinstateMember = {
      form: () => form({ id: suspendedTarget.id }),
      state: () => memberFootprint(suspendedTarget.id),
    };
    cases.deleteMember = {
      form: () => form({ id: suspendedTarget.id }),
      state: () => memberFootprint(suspendedTarget.id),
    };
    cases.closeLoanAsOrganizer = {
      form: () =>
        form({ id: out.id, returnedOn: TODAY, asLent: "yes", note: "Closed" }),
      state: () => loanRow(out.id),
    };
    cases.retireItemAsOrganizer = {
      form: () => form({ id: retireItem.id, note: "Broken" }),
      state: () => db.item.findUniqueOrThrow({ where: { id: retireItem.id } }),
    };
  });

  test("every re-checked action has a case", () => {
    expect(Object.keys(cases).sort()).toEqual(actorRechecked);
  });

  describe.each(["demoted", "suspended"])("an organizer since %s", (kind) => {
    test.each(actorRechecked)("%s → stale, nothing written", async (name) => {
      const before = await cases[name].state();
      const state = await call(name, actors[kind], cases[name].form());
      expect(state).toMatchObject({ formError: "stale" });
      expect(await cases[name].state()).toEqual(before);
      expect(refresh).not.toHaveBeenCalled();
      expect(setFlash).not.toHaveBeenCalled();
    });
  });
});

describe("(c) never the last active organizer", () => {
  // The shared database keeps two active organizers, so the refusal is the
  // data function's, mocked once. The invariant itself is proven by 07's
  // concurrent demote, 18's organizers suspending each other and 20's two
  // last organizers self-deleting.
  const cases: Record<string, () => void> = {
    demoteMember: () =>
      vi.mocked(changeMemberRole).mockResolvedValueOnce("lastOrganizer"),
    suspendMember: () =>
      vi.mocked(suspendMemberAccount).mockResolvedValueOnce("lastOrganizer"),
    deleteOwnAccount: () =>
      vi.mocked(deleteOwnUser).mockResolvedValueOnce("lastOrganizer"),
  };

  test("every guarded action has a case", () => {
    expect(Object.keys(cases).sort()).toEqual(lastOrganizerGuarded);
  });

  test.each(lastOrganizerGuarded)(
    "%s → lastOrganizer, no flash, no refresh",
    async (name) => {
      cases[name]();
      const data =
        name === "deleteOwnAccount"
          ? form({ confirm: "true" })
          : form({ id: member.id });
      const state = await call(name, organizer, data);
      expect(state).toEqual({ formError: "lastOrganizer" });
      expect(refresh).not.toHaveBeenCalled();
      expect(setFlash).not.toHaveBeenCalled();
    },
  );
});

describe("(d) offered on the page ⇔ accepted by the action", () => {
  type Facts = {
    self: boolean;
    role: Role;
    status: MemberStatus;
    activeOrganizers: number;
    loans: EffectiveLoanStatus[];
  };

  // Written from the Auth column and the data functions' refusals.
  function accepted(facts: Facts): string[] {
    if (facts.self) return [];
    const active = facts.status === "active";
    const last =
      facts.role === "organizer" && active && facts.activeOrganizers < 2;
    const out = facts.loans.some((s) => s === "out" || s === "overdue");
    const names: string[] = ["createResetLink"];
    if (active && !last) names.push("suspendMember");
    if (!active) names.push("reinstateMember");
    if (!active && !out) names.push("deleteMember");
    if (active && facts.role === "member") names.push("promoteMember");
    if (active && facts.role === "organizer" && !last) {
      names.push("demoteMember");
    }
    return names.sort();
  }

  const base: Facts = {
    self: false,
    role: "member",
    status: "active",
    activeOrganizers: 2,
    loans: [],
  };
  const CASES: [string, Facts][] = [
    ["own record", { ...base, self: true, role: "organizer" }],
    ["active member", base],
    ["active organizer, not the last", { ...base, role: "organizer" }],
    [
      "the last active organizer",
      { ...base, role: "organizer", activeOrganizers: 1 },
    ],
    ["suspended, nothing out", { ...base, status: "suspended" }],
    [
      "suspended with an approved loan",
      { ...base, status: "suspended", loans: ["approved"] },
    ],
    [
      "suspended with an out loan",
      { ...base, status: "suspended", loans: ["out"] },
    ],
    [
      "suspended with an overdue loan",
      { ...base, status: "suspended", loans: ["overdue"] },
    ],
    [
      "a suspended organizer",
      { ...base, status: "suspended", role: "organizer", activeOrganizers: 1 },
    ],
  ];

  const offered = (page: string) =>
    [...page.matchAll(/data-offer="(\w+)"/g)].map((m) => m[1]).sort();

  test.each(CASES)("member detail: %s", async (_, facts) => {
    const id = "member-1";
    const viewer = viewerOf(facts.self ? id : "organizer-1", "organizer");
    const openLoans: AdminMemberOpenLoan[] = facts.loans.map((status, i) => ({
      id: `loan-${i}`,
      itemTitle: "Ladder",
      side: "lent",
      otherPartyName: "Bora P.",
      status,
      endDate: TODAY,
    }));
    // Through the real mapper: canDelete and isLastActiveOrganizer are its.
    const dto = toAdminMemberDetailDTO(
      {
        id,
        name: "Sam S.",
        role: facts.role,
        status: facts.status,
        area: null,
        createdAt: new Date("2026-01-01T12:00:00Z"),
      },
      viewer.id,
      facts.activeOrganizers,
      openLoans,
    );
    vi.mocked(getAdminMemberDetail).mockResolvedValueOnce(dto);
    vi.mocked(getViewer).mockResolvedValue(viewer);

    const page = await html(
      await MemberDetailSection({ params: Promise.resolve({ id }) }),
    );
    expect(offered(page)).toEqual(accepted(facts));
  });

  const REASONS: AccountDTO["deletion"]["reason"][] = [
    null,
    "item_out",
    "holding_item",
    "last_organizer",
  ];

  test.each(REASONS)("account, deletion reason %s", async (reason) => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(getAccount).mockResolvedValueOnce({
      displayName: "Mira K.",
      area: null,
      contactDetails: null,
      email: "mira@example.test",
      contactDetailsLocked: false,
      deletion: { allowed: reason === null, reason },
    });
    const page = await html(await AccountSections());
    // deleteOwnUser refuses in this order and accepts only when none applies.
    expect(offered(page).includes("deleteOwnAccount")).toBe(reason === null);
  });
});

describe("(e) the lock-first scans", () => {
  // Run in stage-b/organizer-guards; checked here to exist with their scope.
  test("stage-b/organizer-guards scans role/status writers, closedById/retiredById writers and user deleters", () => {
    const suite = readSource(
      "src/__tests__/consolidation/stage-b/organizer-guards.test.ts",
    );
    expect(suite).toMatch(/lockActiveOrganizerIds/);
    expect(suite).toMatch(/closedById/);
    expect(suite).toMatch(/retiredById/);
    expect(suite).toMatch(/function userDeletes/);
  });
});
