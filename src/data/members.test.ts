import { holdRow } from "@/__tests__/support/hold-row";
import {
  storageControl,
  storedFileSize,
} from "@/__tests__/support/photo-storage";
import {
  assertMigrated,
  createTestScope,
  signInForCookie,
  TEST_PASSWORD,
} from "@/__tests__/support/test-db";
import { getBrowseItems, getItemForViewer } from "@/data/browse";
import { fromDbDate } from "@/data/db-dates";
import { joinThroughInvitation } from "@/data/invitations";
import {
  approveLoanRequest,
  closeLoanByOrganizer,
  handOverLoan,
  insertLoanRequest,
  markLoanBack,
} from "@/data/loans";
import {
  insertResetGrant,
  resetPasswordThroughGrant,
} from "@/data/reset-grants";
import { db } from "@/db";
import { createLinkToken, hashLinkToken } from "@/lib/auth/link-tokens";
import { addDays, communityToday } from "@/lib/dates/dates";
import { people } from "@/strings/people";
import {
  changeMemberRole,
  deleteMemberAccount,
  deleteOwnUser,
  getAdminMemberDetail,
  getAdminMembers,
  reinstateMemberAccount,
  suspendMemberAccount,
  toAdminMemberDetailDTO,
} from "./members";

// The disk driver, with a switch to make deletes fail.
vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

// The shared database has other active organizers, so "the last one" can't be
// built for real. While `organizerView.only` is set, every organizer row is
// still locked, but the ids outside it are hidden from the caller.
const organizerView = vi.hoisted(() => ({ only: null as string[] | null }));
vi.mock("@/data/organizer-locks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/data/organizer-locks")>();
  return {
    ...actual,
    async lockActiveOrganizerIds(
      tx: Parameters<typeof actual.lockActiveOrganizerIds>[0],
    ) {
      const ids = await actual.lockActiveOrganizerIds(tx);
      const only = organizerView.only;
      return only ? ids.filter((id) => only.includes(id)) : ids;
    },
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const TODAY = communityToday();

beforeAll(assertMigrated);
afterEach(() => {
  organizerView.only = null;
  storageControl.reset();
});
afterAll(() => scope.cleanup());

const userRow = (id: string) => db.user.findUniqueOrThrow({ where: { id } });
const roleOf = async (id: string) => (await userRow(id)).role;

describe("getAdminMembers", () => {
  // Names carry the scope's tag, so a search finds only this file's users.
  async function threeMembers() {
    const prefix = `${scope.tag} `;
    const cy = await scope.createTestUser({ name: `${prefix}Cy` });
    const ada = await scope.createTestUser({
      name: `${prefix}Ada`,
      role: "organizer",
    });
    const bo = await scope.createTestUser({
      name: `${prefix}Bo`,
      status: "suspended",
    });
    return { cy, ada, bo };
  }

  test("filters by name ignoring case, orders by name, includes every role and status", async () => {
    const { cy, ada, bo } = await threeMembers();

    const rows = await getAdminMembers(scope.tag.toUpperCase(), TODAY);

    expect(rows.map((row) => row.id)).toEqual([ada.id, bo.id, cy.id]);
    expect(rows.map((row) => [row.role, row.status])).toEqual([
      ["organizer", "active"],
      ["member", "suspended"],
      ["member", "active"],
    ]);
  });

  test("an empty search lists everyone, this file's members included", async () => {
    const { cy } = await threeMembers();
    const rows = await getAdminMembers("", TODAY);
    expect(rows.map((row) => row.id)).toContain(cy.id);
  });

  test("% and _ match only themselves, never as wildcards", async () => {
    const prefix = `${scope.tag} `;
    const percent = await scope.createTestUser({ name: `${prefix}50% Off` });
    await scope.createTestUser({ name: `${prefix}5000 Off` });
    const underscore = await scope.createTestUser({ name: `${prefix}a_b` });
    await scope.createTestUser({ name: `${prefix}axb` });

    const byPercent = await getAdminMembers(`${prefix}50%`, TODAY);
    const byUnderscore = await getAdminMembers(`${prefix}a_b`, TODAY);

    expect(byPercent.map((row) => row.id)).toEqual([percent.id]);
    expect(byUnderscore.map((row) => row.id)).toEqual([underscore.id]);
  });

  test("a search with no match is empty", async () => {
    expect(await getAdminMembers(`${scope.tag}-nobody`, TODAY)).toEqual([]);
  });

  test("rows carry no email, contact details or timestamps", async () => {
    const user = await scope.createTestUser({ name: `${scope.tag} Dee K.` });
    const [row] = await getAdminMembers(`${scope.tag} Dee`, TODAY);
    expect(row).toEqual({
      id: user.id,
      displayName: `${scope.tag} Dee K.`,
      initials: expect.any(String),
      role: "member",
      status: "active",
      openLoanCount: 0,
    });
    expect(JSON.stringify(row)).not.toContain(user.email);
  });
});

describe("getAdminMemberDetail", () => {
  test("an unknown id is null", async () => {
    const viewer = await scope.createTestUser({ role: "organizer" });
    expect(
      await getAdminMemberDetail(viewer.id, "no-such-member", TODAY),
    ).toBeNull();
  });

  test("returns the detail DTO: community-date memberSince, no open loans, no email", async () => {
    const viewer = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser({ name: "Mira K." });
    await db.user.update({
      where: { id: member.id },
      data: { area: "north end", contactDetails: "07700 900123" },
    });
    const { createdAt } = await userRow(member.id);

    const detail = await getAdminMemberDetail(viewer.id, member.id, TODAY);

    expect(detail).toEqual({
      id: member.id,
      displayName: "Mira K.",
      initials: "MK",
      role: "member",
      status: "active",
      openLoanCount: 0,
      area: "north end",
      memberSince: communityToday(createdAt),
      openLoans: [],
      isSelf: false,
      isLastActiveOrganizer: false,
      canDelete: false,
    });
    expect(detail?.memberSince).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const wire = JSON.stringify(detail);
    expect(wire).not.toContain(member.email);
    expect(wire).not.toContain("07700");
  });

  test("isSelf is true on the viewer's own record", async () => {
    const viewer = await scope.createTestUser({ role: "organizer" });
    expect(
      await getAdminMemberDetail(viewer.id, viewer.id, TODAY),
    ).toMatchObject({
      isSelf: true,
    });
  });

  // Only a missing row is not-found: spec 18 reinstates from this page.
  test("a suspended member is shown, with status suspended", async () => {
    const viewer = await scope.createTestUser({ role: "organizer" });
    const suspended = await scope.createTestUser({ status: "suspended" });
    expect(
      await getAdminMemberDetail(viewer.id, suspended.id, TODAY),
    ).toMatchObject({
      id: suspended.id,
      status: "suspended",
      isSelf: false,
    });
  });

  test("an organizer with another active organizer is not the last one", async () => {
    const viewer = await scope.createTestUser({ role: "organizer" });
    const other = await scope.createTestUser({ role: "organizer" });
    expect(
      await getAdminMemberDetail(viewer.id, other.id, TODAY),
    ).toMatchObject({
      isLastActiveOrganizer: false,
    });
  });
});

describe("toAdminMemberDetailDTO", () => {
  const row = {
    id: "u1",
    name: "Ada P.",
    role: "organizer" as const,
    status: "active" as const,
    area: null,
    createdAt: new Date("2026-11-08T23:30:00Z"),
  };

  test("the only active organizer is the last one", () => {
    expect(toAdminMemberDetailDTO(row, "u2", 1, []).isLastActiveOrganizer).toBe(
      true,
    );
    expect(toAdminMemberDetailDTO(row, "u2", 2, []).isLastActiveOrganizer).toBe(
      false,
    );
  });

  test("a suspended organizer or a member is never the last active organizer", () => {
    expect(
      toAdminMemberDetailDTO({ ...row, status: "suspended" }, "u2", 1, [])
        .isLastActiveOrganizer,
    ).toBe(false);
    expect(
      toAdminMemberDetailDTO({ ...row, role: "member" }, "u2", 1, [])
        .isLastActiveOrganizer,
    ).toBe(false);
  });

  test("canDelete: a suspended member, not self, with nothing out or overdue", () => {
    const suspended = {
      ...row,
      role: "member" as const,
      status: "suspended" as const,
    };
    const open = (status: "approved" | "out" | "overdue") => ({
      id: `loan-${status}`,
      itemTitle: "Ladder",
      side: "lent" as const,
      otherPartyName: people.formerMember,
      status,
      endDate: "2026-11-20",
    });
    const canDelete = (
      member: Parameters<typeof toAdminMemberDetailDTO>[0],
      viewerId: string,
      loans: ReturnType<typeof open>[],
    ) => toAdminMemberDetailDTO(member, viewerId, 2, loans).canDelete;

    expect(canDelete(suspended, "u2", [])).toBe(true);
    expect(canDelete(suspended, "u2", [open("approved")])).toBe(true);
    expect(canDelete(suspended, "u2", [open("out")])).toBe(false);
    expect(canDelete(suspended, "u2", [open("overdue")])).toBe(false);
    expect(canDelete(suspended, "u1", [])).toBe(false);
    expect(canDelete({ ...row, role: "member" }, "u2", [])).toBe(false);
  });

  test("memberSince is the community date of createdAt, not the UTC date", () => {
    // 23:30 UTC on the 8th is 00:30 on the 9th in Belgrade (CET).
    expect(toAdminMemberDetailDTO(row, "u2", 2, []).memberSince).toBe(
      "2026-11-09",
    );
  });
});

describe("changeMemberRole", () => {
  test("promotes an active member; nothing but the role changes", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser();
    const before = await userRow(member.id);

    expect(
      await changeMemberRole({
        actorId: actor.id,
        memberId: member.id,
        to: "organizer",
      }),
    ).toBe("changed");

    const after = await userRow(member.id);
    expect({ ...after, updatedAt: before.updatedAt }).toEqual({
      ...before,
      role: "organizer",
    });
    expect(await scope.sessionsOf(member.id)).toEqual([]);
  });

  test("demotes another active organizer", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const target = await scope.createTestUser({ role: "organizer" });

    expect(
      await changeMemberRole({
        actorId: actor.id,
        memberId: target.id,
        to: "member",
      }),
    ).toBe("changed");
    expect(await userRow(target.id)).toMatchObject({
      role: "member",
      status: "active",
    });
  });

  test.each([
    ["promote an organizer", "organizer", "active", "organizer"],
    ["promote a suspended member", "member", "suspended", "organizer"],
    ["demote a member", "member", "active", "member"],
    ["demote a suspended organizer", "organizer", "suspended", "member"],
  ] as const)(
    "%s is stale and writes nothing",
    async (_label, role, status, to) => {
      const actor = await scope.createTestUser({ role: "organizer" });
      const target = await scope.createTestUser({ role, status });
      const before = await userRow(target.id);

      expect(
        await changeMemberRole({ actorId: actor.id, memberId: target.id, to }),
      ).toBe("stale");
      expect(await userRow(target.id)).toEqual(before);
    },
  );

  test.each(["organizer", "member"] as const)(
    "an unknown target (to %s) is stale",
    async (to) => {
      const actor = await scope.createTestUser({ role: "organizer" });
      expect(
        await changeMemberRole({ actorId: actor.id, memberId: "no-such", to }),
      ).toBe("stale");
    },
  );

  test.each([
    ["a member", "member", "active"],
    ["a suspended organizer", "organizer", "suspended"],
  ] as const)(
    "an actor who is %s is stale and writes nothing",
    async (_label, role, status) => {
      const actor = await scope.createTestUser({ role, status });
      const target = await scope.createTestUser();
      expect(
        await changeMemberRole({
          actorId: actor.id,
          memberId: target.id,
          to: "organizer",
        }),
      ).toBe("stale");
      expect(await roleOf(target.id)).toBe("member");
    },
  );

  // The concurrent-demote test: each call is its own interactive transaction on
  // its own pooled connection. A third transaction holds both rows until both
  // calls have started, so they really overlap (unheld, the two finish one
  // after the other and an unlocked guard would pass too). The second queues on
  // the organizer locks, then no longer finds its actor among the active
  // organizers.
  test("two organizers demoting each other at once: exactly one wins", async () => {
    const a = await scope.createTestUser({ role: "organizer" });
    const b = await scope.createTestUser({ role: "organizer" });

    let rowsHeld!: () => void;
    const held = new Promise<void>((resolve) => (rowsHeld = resolve));
    const holder = db.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM "user" WHERE id IN (${a.id}, ${b.id})
          ORDER BY id FOR UPDATE`;
        rowsHeld();
        await tx.$executeRaw`SELECT pg_sleep(2)`;
      },
      { maxWait: 15_000, timeout: 30_000 },
    );
    await held;

    const outcomes = await Promise.all([
      changeMemberRole({ actorId: a.id, memberId: b.id, to: "member" }),
      changeMemberRole({ actorId: b.id, memberId: a.id, to: "member" }),
    ]);
    await holder;

    expect([...outcomes].sort()).toEqual(["changed", "stale"]);
    const roles = [await roleOf(a.id), await roleOf(b.id)];
    expect(roles.filter((role) => role === "organizer")).toHaveLength(1);
    // The winner is the one still an organizer.
    const winnerIsA = outcomes[0] === "changed";
    expect(roles).toEqual(
      winnerIsA ? ["organizer", "member"] : ["member", "organizer"],
    );
  });
});
// One loan per item, so approved and out rows never overlap. Both seen-ats
// start at OLD, so a moved one shows.
const OLD = new Date("2026-01-01T00:00:00.000Z");
const loanRow = (id: string) => db.loan.findUniqueOrThrow({ where: { id } });
const itemRow = (id: string) => db.item.findUniqueOrThrow({ where: { id } });
const invitationRow = (id: string) =>
  db.invitation.findUniqueOrThrow({ where: { id } });

const STATES = [
  ["requested", "requested", 2, 3],
  ["expired", "requested", -3, -2],
  ["approved", "approved", 1, 3],
  ["lapsed", "approved", -5, -2],
  ["out", "out", -1, 2],
  ["overdue", "out", -5, -1],
  ["returned", "returned", -10, -8],
  ["declined", "declined", 2, 3],
  ["cancelled", "cancelled", 2, 3],
] as const;
type State = (typeof STATES)[number];
type Effective = State[0];
const stateOf = (name: Effective) => STATES.find(([key]) => key === name)!;

async function loanIn(
  ownerId: string,
  borrowerId: string | null,
  [, status, start, end]: State,
) {
  const { id: itemId } = await scope.createItem({ ownerId, status: "listed" });
  const { id } = await scope.createLoan({
    itemId,
    borrowerId,
    status,
    startDate: addDays(TODAY, start),
    endDate: addDays(TODAY, end),
    ownerSeenAt: OLD,
    borrowerSeenAt: OLD,
  });
  return { id, itemId };
}

const suspend = (actorId: string, memberId: string) =>
  suspendMemberAccount({ actorId, memberId, today: TODAY });

describe("suspendMemberAccount", () => {
  test("sweeps effective requests and approvals on both sides; leaves everything else as it was", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser();
    const other = await scope.createTestUser();
    await signInForCookie({ ...member, ip: scope.ip() });
    expect(await scope.sessionsOf(member.id)).not.toEqual([]);

    const lent = new Map<Effective, { id: string; itemId: string }>();
    const borrowed = new Map<Effective, { id: string; itemId: string }>();
    for (const state of STATES) {
      lent.set(state[0], await loanIn(member.id, other.id, state));
      borrowed.set(state[0], await loanIn(other.id, member.id, state));
    }
    const all = [...lent.values(), ...borrowed.values()];
    const loansBefore = new Map(
      await Promise.all(
        all.map(async ({ id }) => [id, await loanRow(id)] as const),
      ),
    );
    const itemsBefore = await Promise.all(
      all.map(({ itemId }) => itemRow(itemId)),
    );
    const userBefore = await userRow(member.id);

    const startedAt = Date.now();
    expect(await suspend(actor.id, member.id)).toBe("suspended");
    const endedAt = Date.now();

    const swept = {
      lent: { requested: "declined", approved: "cancelled" },
      borrowed: { requested: "cancelled", approved: "cancelled" },
    } as const;
    for (const [side, loans] of [
      ["lent", lent],
      ["borrowed", borrowed],
    ] as const) {
      for (const [state, { id }] of loans) {
        const after = await loanRow(id);
        if (state !== "requested" && state !== "approved") {
          expect(after, `${side} ${state}`).toEqual(loansBefore.get(id));
          continue;
        }
        const mine = side === "lent" ? "ownerSeenAt" : "borrowerSeenAt";
        const theirs = side === "lent" ? "borrowerSeenAt" : "ownerSeenAt";
        expect(after, `${side} ${state}`).toMatchObject({
          status: swept[side][state],
          endedBy: "system",
          systemReason:
            side === "lent" ? "owner_suspended" : "borrower_suspended",
          statusReason: null,
          [mine]: after.changedAt,
          [theirs]: OLD,
        });
        expect(after.changedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(after.changedAt.getTime()).toBeLessThanOrEqual(endedAt);
      }
    }

    expect(await Promise.all(all.map(({ itemId }) => itemRow(itemId)))).toEqual(
      itemsBefore,
    );
    const userAfter = await userRow(member.id);
    expect({ ...userAfter, updatedAt: userBefore.updatedAt }).toEqual({
      ...userBefore,
      status: "suspended",
    });
    expect(await scope.sessionsOf(member.id)).toEqual([]);
  });

  test("an organizer's open invitations are revoked; their other ones and other organizers' are not", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const target = await scope.createTestUser({ role: "organizer" });
    const open = await scope.createInvitation({ createdById: target.id });
    const rest = await Promise.all(
      (["used", "expired", "revoked"] as const).map((state) =>
        scope.createInvitation({ createdById: target.id, state }),
      ),
    );
    const untouched = [
      ...rest,
      await scope.createInvitation({ createdById: actor.id }),
    ];
    const before = await Promise.all(
      untouched.map(({ id }) => invitationRow(id)),
    );

    const startedAt = Date.now();
    expect(await suspend(actor.id, target.id)).toBe("suspended");

    const { revokedAt } = await invitationRow(open.id);
    expect(revokedAt!.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(
      await Promise.all(untouched.map(({ id }) => invitationRow(id))),
    ).toEqual(before);
    expect(await userRow(target.id)).toMatchObject({
      role: "organizer",
      status: "suspended",
    });
    expect(
      await joinThroughInvitation({
        tokenHash: hashLinkToken(open.token),
        name: "Mira K.",
        email: scope.email(),
        password: TEST_PASSWORD,
      }),
    ).toEqual({ kind: "invalidToken" });
  });

  test("a member's suspension writes no invitation, even one made while an organizer", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser();
    const { id } = await scope.createInvitation({ createdById: member.id });
    const before = await invitationRow(id);

    expect(await suspend(actor.id, member.id)).toBe("suspended");

    expect(await invitationRow(id)).toEqual(before);
  });

  test.each([
    ["an already suspended member", "suspended"],
    ["an unknown id", "unknown"],
    ["an actor who is only a member", "memberActor"],
    ["an actor who is a suspended organizer", "suspendedActor"],
  ] as const)("%s is stale and nothing is written", async (_label, kind) => {
    const actor = await scope.createTestUser({
      role: kind === "memberActor" ? "member" : "organizer",
      status: kind === "suspendedActor" ? "suspended" : "active",
    });
    const target = await scope.createTestUser({
      status: kind === "suspended" ? "suspended" : "active",
    });
    const other = await scope.createTestUser();
    const { id: loanId } = await loanIn(
      other.id,
      target.id,
      stateOf("requested"),
    );
    const before = [await userRow(target.id), await loanRow(loanId)];

    expect(
      await suspend(
        actor.id,
        kind === "unknown" ? "no-such-member" : target.id,
      ),
    ).toBe("stale");

    expect([await userRow(target.id), await loanRow(loanId)]).toEqual(before);
  });

  test("a borrower's suspension leaves their out loan for the owner to mark back", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const owner = await scope.createTestUser();
    const borrower = await scope.createTestUser();
    const { id } = await loanIn(owner.id, borrower.id, stateOf("out"));

    expect(await suspend(actor.id, borrower.id)).toBe("suspended");
    expect(await loanRow(id)).toMatchObject({ status: "out" });

    expect(
      await markLoanBack(
        owner.id,
        { id, returnedOn: TODAY, asLent: "yes" },
        TODAY,
      ),
    ).toBe("returned");
  });

  test("the member's items leave browse and their page until reinstatement, with no item write", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const owner = await scope.createTestUser();
    const viewer = {
      id: (await scope.createTestUser()).id,
      role: "member" as const,
    };
    const title = `${scope.tag} Hedge trimmer`;
    const { id: itemId } = await scope.createItem({
      ownerId: owner.id,
      status: "listed",
      title,
    });
    const before = await itemRow(itemId);
    const browse = async () =>
      (
        await getBrowseItems(
          viewer.id,
          { q: title, category: null, page: 1 },
          TODAY,
        )
      ).items.map(({ id }) => id);

    expect(await browse()).toEqual([itemId]);
    expect(await suspend(actor.id, owner.id)).toBe("suspended");
    expect(await browse()).toEqual([]);
    expect(await getItemForViewer(viewer, itemId, TODAY)).toBeNull();
    expect(await itemRow(itemId)).toEqual(before);

    expect(
      await reinstateMemberAccount({ actorId: actor.id, memberId: owner.id }),
    ).toBe("reinstated");
    expect(await browse()).toEqual([itemId]);
    expect(await getItemForViewer(viewer, itemId, TODAY)).not.toBeNull();
  });
});

describe("reinstateMemberAccount", () => {
  test("writes status active only: swept loans stay ended, invitations stay revoked, no session", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const target = await scope.createTestUser({ role: "organizer" });
    const other = await scope.createTestUser();
    const { id: loanId } = await loanIn(
      other.id,
      target.id,
      stateOf("requested"),
    );
    const invitation = await scope.createInvitation({ createdById: target.id });
    expect(await suspend(actor.id, target.id)).toBe("suspended");
    const before = {
      user: await userRow(target.id),
      loan: await loanRow(loanId),
      invitation: await invitationRow(invitation.id),
    };

    expect(
      await reinstateMemberAccount({ actorId: actor.id, memberId: target.id }),
    ).toBe("reinstated");

    const user = await userRow(target.id);
    expect({ ...user, updatedAt: before.user.updatedAt }).toEqual({
      ...before.user,
      status: "active",
    });
    expect(await loanRow(loanId)).toEqual(before.loan);
    expect(await invitationRow(invitation.id)).toEqual(before.invitation);
    expect(await scope.sessionsOf(target.id)).toEqual([]);
  });

  test.each([
    ["an active member", "active"],
    ["an unknown id", "unknown"],
    ["an actor who is no longer an organizer", "memberActor"],
  ] as const)("%s is stale and nothing is written", async (_label, kind) => {
    const actor = await scope.createTestUser({
      role: kind === "memberActor" ? "member" : "organizer",
    });
    const target = await scope.createTestUser({
      status: kind === "active" ? "active" : "suspended",
    });
    const before = await userRow(target.id);

    expect(
      await reinstateMemberAccount({
        actorId: actor.id,
        memberId: kind === "unknown" ? "no-such-member" : target.id,
      }),
    ).toBe("stale");
    expect(await userRow(target.id)).toEqual(before);
  });
});

describe("open loans on the members pages", () => {
  test("exactly the approved, out and overdue loans on either side, by end date then id", async () => {
    const viewer = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser({ name: `${scope.tag} Mira K.` });
    const other = await scope.createTestUser({ name: `${scope.tag} Tom B.` });
    const lent = new Map<Effective, string>();
    const borrowed = new Map<Effective, string>();
    for (const state of STATES) {
      lent.set(state[0], (await loanIn(member.id, other.id, state)).id);
      borrowed.set(state[0], (await loanIn(other.id, member.id, state)).id);
    }
    // A deleted borrower leaves a null id: "Former member".
    const gone = await loanIn(member.id, null, stateOf("overdue"));
    const open = ["approved", "out", "overdue"] as const;
    const expected = [
      ...open.map((status) => ({
        id: lent.get(status)!,
        side: "lent" as const,
        otherPartyName: `${scope.tag} Tom B.`,
        status,
      })),
      ...open.map((status) => ({
        id: borrowed.get(status)!,
        side: "borrowed" as const,
        otherPartyName: `${scope.tag} Tom B.`,
        status,
      })),
      {
        id: gone.id,
        side: "lent" as const,
        otherPartyName: people.formerMember,
        status: "overdue" as const,
      },
    ];
    const ends = await db.loan.findMany({
      where: { id: { in: expected.map(({ id }) => id) } },
      select: { id: true, endDate: true },
    });
    const endOf = new Map(ends.map((row) => [row.id, fromDbDate(row.endDate)]));
    const ordered = expected
      .map((loan) => ({
        ...loan,
        itemTitle: "Ladder",
        endDate: endOf.get(loan.id)!,
      }))
      .sort((a, b) =>
        a.endDate === b.endDate
          ? a.id < b.id
            ? -1
            : 1
          : a.endDate < b.endDate
            ? -1
            : 1,
      );

    const detail = await getAdminMemberDetail(viewer.id, member.id, TODAY);

    expect(detail?.openLoans).toEqual(ordered);
    expect(detail?.openLoanCount).toBe(7);
    const rows = await getAdminMembers(scope.tag, TODAY);
    expect(
      Object.fromEntries(rows.map((row) => [row.id, row.openLoanCount])),
    ).toMatchObject({ [member.id]: 7, [other.id]: 6 });
    expect(JSON.stringify(detail)).not.toMatch(
      new RegExp(`${other.id}|${member.email}|${other.email}`),
    );
  });
});

describe("suspension under concurrency (held rows, either order, no 40P01)", () => {
  // Starts `first`, waits until it queues behind the held row, then `second`.
  async function inOrder<A, B>(
    held: ReturnType<typeof holdRow>,
    first: () => Promise<A>,
    second: () => Promise<B>,
  ): Promise<[A, B]> {
    // The holder must have its lock before anyone races it for the row.
    await held.held;
    const a = first();
    await held.queued(1);
    const b = second();
    await held.queued(2);
    held.release();
    await held.done;
    return [await a, await b];
  }

  test.each(["approve first", "suspend first"] as const)(
    "suspend vs approve on the member's item, %s: nothing stays requested or approved",
    async (order) => {
      const actor = await scope.createTestUser({ role: "organizer" });
      const member = await scope.createTestUser();
      const borrower = await scope.createTestUser();
      const { id, itemId } = await loanIn(
        member.id,
        borrower.id,
        stateOf("requested"),
      );
      const approve = () => approveLoanRequest(member.id, id, TODAY);
      const suspendIt = () => suspend(actor.id, member.id);

      const held = holdRow("item", itemId);
      if (order === "approve first") {
        expect(await inOrder(held, approve, suspendIt)).toEqual([
          "approved",
          "suspended",
        ]);
        expect(await loanRow(id)).toMatchObject({
          status: "cancelled",
          systemReason: "owner_suspended",
        });
      } else {
        expect(await inOrder(held, suspendIt, approve)).toEqual([
          "suspended",
          "stale",
        ]);
        expect(await loanRow(id)).toMatchObject({
          status: "declined",
          systemReason: "owner_suspended",
        });
      }
    },
  );

  test.each(["request first", "suspend first"] as const)(
    "suspend vs the member's own request, %s: no open request remains",
    async (order) => {
      const actor = await scope.createTestUser({ role: "organizer" });
      const member = await scope.createTestUser({
        contactDetails: "07700 900123",
      });
      const owner = await scope.createTestUser();
      const { id: itemId } = await scope.createItem({
        ownerId: owner.id,
        status: "listed",
      });
      const request = () =>
        insertLoanRequest(
          member.id,
          {
            itemId,
            startDate: addDays(TODAY, 2),
            endDate: addDays(TODAY, 3),
            message: null,
          },
          TODAY,
        );
      const suspendIt = () => suspend(actor.id, member.id);

      const held = holdRow("user", member.id);
      if (order === "request first") {
        const [created, suspended] = await inOrder(held, request, suspendIt);
        expect(created.kind).toBe("created");
        expect(suspended).toBe("suspended");
      } else {
        expect(await inOrder(held, suspendIt, request)).toEqual([
          "suspended",
          { kind: "stale" },
        ]);
      }
      const loans = await db.loan.findMany({
        where: { borrowerId: member.id },
      });
      expect(loans).toHaveLength(order === "request first" ? 1 : 0);
      for (const loan of loans) {
        expect(loan).toMatchObject({
          status: "cancelled",
          systemReason: "borrower_suspended",
        });
      }
    },
  );

  test("two organizers suspending each other: exactly one is suspended", async () => {
    const a = await scope.createTestUser({ role: "organizer" });
    const b = await scope.createTestUser({ role: "organizer" });

    // Either may win; both must be queued on the organizer locks first.
    const held = holdRow("user", a.id);
    await held.held;
    const both = Promise.all([suspend(a.id, b.id), suspend(b.id, a.id)]);
    await held.queued(2);
    held.release();
    await held.done;
    const outcomes = await both;

    expect([...outcomes].sort()).toEqual(["stale", "suspended"]);
    const statuses = [
      (await userRow(a.id)).status,
      (await userRow(b.id)).status,
    ];
    expect(statuses).toEqual(
      outcomes[0] === "suspended"
        ? ["active", "suspended"]
        : ["suspended", "active"],
    );
  });
});
const NOT_OUT = STATES.filter(([name]) => name !== "out" && name !== "overdue");
const userGone = async (id: string) =>
  (await db.user.findUnique({ where: { id } })) === null;
const authRows = async (userId: string) => ({
  sessions: await db.session.count({ where: { userId } }),
  accounts: await db.account.count({ where: { userId } }),
  grants: await db.passwordResetGrant.count({ where: { userId } }),
});
const queueRows = (storageKey: string) =>
  db.pendingBlobDeletion.findMany({ where: { storageKey } });
const deleteOther = (actorId: string, memberId: string) =>
  deleteMemberAccount({ actorId, memberId, today: TODAY });

describe("deleteOwnUser", () => {
  test("sweeps effective requests and approvals as account_deleted; every other loan keeps its row but the nulled borrower", async () => {
    const member = await scope.createTestUser();
    const other = await scope.createTestUser();
    await signInForCookie({ ...member, ip: scope.ip() });
    await scope.createResetGrant({ userId: member.id });
    expect(await authRows(member.id)).toEqual({
      sessions: 1,
      accounts: 1,
      grants: 1,
    });

    const lent = new Map<Effective, { id: string; itemId: string }>();
    const borrowed = new Map<Effective, { id: string; itemId: string }>();
    for (const state of NOT_OUT) {
      lent.set(state[0], await loanIn(member.id, other.id, state));
      borrowed.set(state[0], await loanIn(other.id, member.id, state));
    }
    const all = [...lent.values(), ...borrowed.values()];
    const before = new Map(
      await Promise.all(
        all.map(async ({ id }) => [id, await loanRow(id)] as const),
      ),
    );

    const startedAt = Date.now();
    expect(await deleteOwnUser(member.id, TODAY)).toBe("deleted");
    const endedAt = Date.now();

    const swept = {
      lent: { requested: "declined", approved: "cancelled" },
      borrowed: { requested: "cancelled", approved: "cancelled" },
    } as const;
    for (const [side, loans] of [
      ["lent", lent],
      ["borrowed", borrowed],
    ] as const) {
      const borrowerId = side === "lent" ? other.id : null;
      for (const [state, { id }] of loans) {
        const after = await loanRow(id);
        if (state !== "requested" && state !== "approved") {
          expect(after, `${side} ${state}`).toEqual({
            ...before.get(id),
            borrowerId,
          });
          continue;
        }
        const mine = side === "lent" ? "ownerSeenAt" : "borrowerSeenAt";
        const theirs = side === "lent" ? "borrowerSeenAt" : "ownerSeenAt";
        expect(after, `${side} ${state}`).toMatchObject({
          status: swept[side][state],
          endedBy: "system",
          systemReason: "account_deleted",
          statusReason: null,
          borrowerId,
          [mine]: after.changedAt,
          [theirs]: OLD,
        });
        expect(after.changedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
        expect(after.changedAt.getTime()).toBeLessThanOrEqual(endedAt);
      }
    }
    expect(await userGone(member.id)).toBe(true);
    expect(await authRows(member.id)).toEqual({
      sessions: 0,
      accounts: 0,
      grants: 0,
    });
  });

  test("never-lent items are deleted, the rest retired without note or retirer; a retired one keeps its row", async () => {
    const member = await scope.createTestUser();
    const other = await scope.createTestUser();
    const organizer = await scope.createTestUser({ role: "organizer" });
    const photos = [
      await scope.createStoredPhoto(),
      await scope.createStoredPhoto(),
      await scope.createStoredPhoto(),
    ];
    const hidden = await scope.createItem({
      ownerId: member.id,
      photo: photos[0],
    });
    const listed = await scope.createItem({
      ownerId: member.id,
      status: "listed",
      photo: photos[1],
    });
    const lent = await scope.createItem({
      ownerId: member.id,
      status: "listed",
      photo: photos[2],
    });
    await scope.createLoan({
      itemId: lent.id,
      borrowerId: other.id,
      status: "returned",
      startDate: addDays(TODAY, -10),
      endDate: addDays(TODAY, -8),
    });
    const retired = await scope.createItem({
      ownerId: member.id,
      status: "retired",
    });
    await db.item.update({
      where: { id: retired.id },
      data: { retiredById: organizer.id, retiredNote: "Broken handle" },
    });
    const retiredBefore = await itemRow(retired.id);

    const startedAt = Date.now();
    expect(await deleteOwnUser(member.id, TODAY)).toBe("deleted");

    expect(await db.item.findUnique({ where: { id: hidden.id } })).toBeNull();
    expect(await db.item.findUnique({ where: { id: listed.id } })).toBeNull();
    const after = await itemRow(lent.id);
    expect(after).toMatchObject({
      status: "retired",
      ownerId: null,
      retiredNote: null,
      retiredById: null,
      photoKey: null,
      photoUrl: null,
      photoWidth: null,
      photoHeight: null,
      photoBytes: null,
    });
    expect(after.retiredAt!.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(await itemRow(retired.id)).toEqual({
      ...retiredBefore,
      ownerId: null,
    });
    for (const { photoKey } of photos) {
      expect(await storedFileSize(photoKey)).toBeNull();
      expect(await queueRows(photoKey)).toEqual([]);
    }
  });

  test("each stored photo is queued once in the transaction; a failed delete stays queued", async () => {
    const member = await scope.createTestUser();
    const other = await scope.createTestUser();
    const photos = [
      await scope.createStoredPhoto(),
      await scope.createStoredPhoto(),
    ];
    await scope.createItem({ ownerId: member.id, photo: photos[0] });
    const lent = await scope.createItem({
      ownerId: member.id,
      status: "listed",
      photo: photos[1],
    });
    await scope.createLoan({
      itemId: lent.id,
      borrowerId: other.id,
      status: "returned",
      startDate: addDays(TODAY, -10),
      endDate: addDays(TODAY, -8),
    });
    storageControl.failDelete = new Error("storage down");

    expect(await deleteOwnUser(member.id, TODAY)).toBe("deleted");

    for (const photo of photos) {
      expect(await queueRows(photo.photoKey)).toEqual([
        expect.objectContaining({ bytes: photo.photoBytes, attempts: 1 }),
      ]);
      expect(await storedFileSize(photo.photoKey)).toBe(photo.photoBytes);
    }
  });

  test("every other reference to the member becomes null and its row survives", async () => {
    const member = await scope.createTestUser({ role: "organizer" });
    const owner = await scope.createTestUser();
    const borrower = await scope.createTestUser();
    const { id: borrowedLoan } = await loanIn(
      owner.id,
      member.id,
      stateOf("returned"),
    );
    const { id: closedLoan } = await loanIn(
      owner.id,
      borrower.id,
      stateOf("returned"),
    );
    await db.loan.update({
      where: { id: closedLoan },
      data: { closedById: member.id, statusReason: "Back in the shed" },
    });
    const owned = await scope.createItem({
      ownerId: member.id,
      status: "retired",
    });
    const retiredByMember = await scope.createItem({
      ownerId: owner.id,
      status: "retired",
    });
    await db.item.update({
      where: { id: retiredByMember.id },
      data: { retiredById: member.id, retiredNote: "Rusty" },
    });
    const created = await scope.createInvitation({
      createdById: member.id,
      state: "used",
    });
    const used = await scope.createInvitation({
      createdById: owner.id,
      state: "used",
    });
    await db.invitation.update({
      where: { id: used.id },
      data: { usedById: member.id },
    });
    const grant = await scope.createResetGrant({
      userId: owner.id,
      createdById: member.id,
    });
    const upload = await db.uploadLog.create({
      data: { userId: member.id, bytes: 1000 },
      select: { id: true },
    });

    try {
      expect(await deleteOwnUser(member.id, TODAY)).toBe("deleted");

      expect(await loanRow(borrowedLoan)).toMatchObject({
        borrowerId: null,
        status: "returned",
      });
      expect(await loanRow(closedLoan)).toMatchObject({
        closedById: null,
        statusReason: "Back in the shed",
        borrowerId: borrower.id,
      });
      expect(await itemRow(owned.id)).toMatchObject({
        ownerId: null,
        status: "retired",
      });
      expect(await itemRow(retiredByMember.id)).toMatchObject({
        retiredById: null,
        retiredNote: "Rusty",
        ownerId: owner.id,
      });
      expect(await invitationRow(created.id)).toMatchObject({
        createdById: null,
        revokedAt: null,
      });
      expect(await invitationRow(used.id)).toMatchObject({
        usedById: null,
        createdById: owner.id,
      });
      expect(
        await db.passwordResetGrant.findUniqueOrThrow({
          where: { id: grant.id },
        }),
      ).toMatchObject({ createdById: null, userId: owner.id });
      expect(
        await db.uploadLog.findUniqueOrThrow({ where: { id: upload.id } }),
      ).toMatchObject({ userId: null, bytes: 1000 });
    } finally {
      // Cleanup finds upload rows by user, which this one no longer has.
      await db.uploadLog.deleteMany({ where: { id: upload.id } });
    }
  });

  test("an organizer's self-delete revokes exactly their open invitations", async () => {
    const member = await scope.createTestUser({ role: "organizer" });
    const otherOrganizer = await scope.createTestUser({ role: "organizer" });
    const open = await scope.createInvitation({ createdById: member.id });
    const closed = await Promise.all(
      (["expired", "revoked"] as const).map((state) =>
        scope.createInvitation({ createdById: member.id, state }),
      ),
    );
    const others = await scope.createInvitation({
      createdById: otherOrganizer.id,
    });
    const before = await Promise.all(
      [...closed, others].map(({ id }) => invitationRow(id)),
    );

    const startedAt = Date.now();
    expect(await deleteOwnUser(member.id, TODAY)).toBe("deleted");

    const revoked = await invitationRow(open.id);
    expect(revoked.createdById).toBeNull();
    expect(revoked.revokedAt!.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(
      await Promise.all(closed.map(({ id }) => invitationRow(id))),
    ).toEqual(before.slice(0, 2).map((row) => ({ ...row, createdById: null })));
    expect(await invitationRow(others.id)).toEqual(before[2]);
  });

  test("a member's self-delete writes no revokedAt, even on an invitation made while an organizer", async () => {
    const member = await scope.createTestUser();
    const { id } = await scope.createInvitation({ createdById: member.id });
    const before = await invitationRow(id);

    expect(await deleteOwnUser(member.id, TODAY)).toBe("deleted");

    expect(await invitationRow(id)).toEqual({ ...before, createdById: null });
  });

  type OutLoan =
    "lent-out" | "lent-overdue" | "borrowed-out" | "borrowed-overdue";
  test.each([
    ["an out loan on an owned item", "itemOut", ["lent-out"]],
    ["an overdue loan on an owned item", "itemOut", ["lent-overdue"]],
    ["an out loan as borrower", "holdingItem", ["borrowed-out"]],
    ["an overdue loan as borrower", "holdingItem", ["borrowed-overdue"]],
    ["one of each at once", "itemOut", ["borrowed-out", "lent-out"]],
  ] as [string, "itemOut" | "holdingItem", OutLoan[]][])(
    "%s is %s and nothing is written",
    async (_label, outcome, outLoans) => {
      const member = await scope.createTestUser();
      const other = await scope.createTestUser();
      await signInForCookie({ ...member, ip: scope.ip() });
      const photo = await scope.createStoredPhoto();
      const { id: neverLent } = await scope.createItem({
        ownerId: member.id,
        photo,
      });
      const loans = [await loanIn(member.id, other.id, stateOf("requested"))];
      for (const kind of outLoans) {
        const [side, state] = kind.split("-") as [
          "lent" | "borrowed",
          Effective,
        ];
        loans.push(
          side === "lent"
            ? await loanIn(member.id, other.id, stateOf(state))
            : await loanIn(other.id, member.id, stateOf(state)),
        );
      }
      const snapshot = async () => ({
        user: await userRow(member.id),
        loans: await Promise.all(loans.map(({ id }) => loanRow(id))),
        items: await Promise.all(
          [neverLent, ...loans.map(({ itemId }) => itemId)].map(itemRow),
        ),
      });
      const before = await snapshot();

      expect(await deleteOwnUser(member.id, TODAY)).toBe(outcome);

      expect(await snapshot()).toEqual(before);
      expect((await authRows(member.id)).sessions).toBe(1);
      expect(await queueRows(photo.photoKey)).toEqual([]);
      expect(await storedFileSize(photo.photoKey)).toBe(photo.photoBytes);
    },
  );

  test("the only active organizer is refused lastOrganizer and nothing is written", async () => {
    const member = await scope.createTestUser({ role: "organizer" });
    const other = await scope.createTestUser();
    const loan = await loanIn(member.id, other.id, stateOf("requested"));
    const invitation = await scope.createInvitation({ createdById: member.id });
    const snapshot = async () => [
      await userRow(member.id),
      await loanRow(loan.id),
      await itemRow(loan.itemId),
      await invitationRow(invitation.id),
    ];
    const before = await snapshot();
    organizerView.only = [member.id];

    expect(await deleteOwnUser(member.id, TODAY)).toBe("lastOrganizer");

    expect(await snapshot()).toEqual(before);
  });

  test("with a second active organizer, the same self-delete goes through", async () => {
    const member = await scope.createTestUser({ role: "organizer" });
    const second = await scope.createTestUser({ role: "organizer" });
    organizerView.only = [member.id, second.id];

    expect(await deleteOwnUser(member.id, TODAY)).toBe("deleted");
    expect(await userGone(member.id)).toBe(true);
  });

  test.each([
    ["a suspended account", "suspended"],
    ["an unknown id", "unknown"],
  ] as const)("%s is stale and nothing is written", async (_label, kind) => {
    const member = await scope.createTestUser({ status: "suspended" });
    const other = await scope.createTestUser();
    const loan = await loanIn(other.id, member.id, stateOf("requested"));
    const before = [await userRow(member.id), await loanRow(loan.id)];

    expect(
      await deleteOwnUser(
        kind === "unknown" ? "no-such-member" : member.id,
        TODAY,
      ),
    ).toBe("stale");

    expect([await userRow(member.id), await loanRow(loan.id)]).toEqual(before);
  });
});

describe("deleteMemberAccount", () => {
  test("deletes a suspended member through the same workflow", async () => {
    const actor = await scope.createTestUser({ role: "organizer" });
    const target = await scope.createTestUser();
    const other = await scope.createTestUser();
    const photo = await scope.createStoredPhoto();
    const { id: neverLent } = await scope.createItem({
      ownerId: target.id,
      status: "listed",
      photo,
    });
    const lent = await loanIn(target.id, other.id, stateOf("returned"));
    const requested = await loanIn(other.id, target.id, stateOf("requested"));
    await scope.createResetGrant({ userId: target.id });
    expect(await suspend(actor.id, target.id)).toBe("suspended");

    expect(await deleteOther(actor.id, target.id)).toBe("deleted");

    expect(await userGone(target.id)).toBe(true);
    expect(await authRows(target.id)).toEqual({
      sessions: 0,
      accounts: 0,
      grants: 0,
    });
    expect(await db.item.findUnique({ where: { id: neverLent } })).toBeNull();
    expect(await itemRow(lent.itemId)).toMatchObject({
      status: "retired",
      ownerId: null,
    });
    // Swept at suspension; the deletion only nulls the borrower.
    expect(await loanRow(requested.id)).toMatchObject({
      status: "cancelled",
      systemReason: "borrower_suspended",
      borrowerId: null,
    });
    expect(await storedFileSize(photo.photoKey)).toBeNull();
  });

  test.each([
    ["an active target", "active"],
    ["an unknown id", "unknown"],
    ["an actor who is only a member", "memberActor"],
    ["an actor who is a suspended organizer", "suspendedActor"],
  ] as const)("%s is stale and nothing is written", async (_label, kind) => {
    const actor = await scope.createTestUser({
      role: kind === "memberActor" ? "member" : "organizer",
      status: kind === "suspendedActor" ? "suspended" : "active",
    });
    const target = await scope.createTestUser({
      status: kind === "active" ? "active" : "suspended",
    });
    const { id: itemId } = await scope.createItem({ ownerId: target.id });
    const before = [await userRow(target.id), await itemRow(itemId)];

    expect(
      await deleteOther(
        actor.id,
        kind === "unknown" ? "no-such-member" : target.id,
      ),
    ).toBe("stale");

    expect([await userRow(target.id), await itemRow(itemId)]).toEqual(before);
  });

  test.each([
    ["an item out", "itemOut", "lent"],
    ["an item held", "holdingItem", "borrowed"],
  ] as const)(
    "a suspended target with %s is %s and nothing is written",
    async (_label, outcome, side) => {
      const actor = await scope.createTestUser({ role: "organizer" });
      const target = await scope.createTestUser({ status: "suspended" });
      const other = await scope.createTestUser();
      const loan =
        side === "lent"
          ? await loanIn(target.id, other.id, stateOf("overdue"))
          : await loanIn(other.id, target.id, stateOf("out"));
      const snapshot = async () => [
        await userRow(target.id),
        await loanRow(loan.id),
        await itemRow(loan.itemId),
      ];
      const before = await snapshot();

      expect(await deleteOther(actor.id, target.id)).toBe(outcome);

      expect(await snapshot()).toEqual(before);
    },
  );
});

// A reset grant held until released, as holdRow holds an item or user row.
function holdGrant(id: string): ReturnType<typeof holdRow> {
  let rowHeld!: (pid: number) => void;
  let release!: () => void;
  const held = new Promise<number>((resolve) => (rowHeld = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const done = db.$transaction(
    async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM password_reset_grant WHERE id = ${id} FOR UPDATE`;
      const [{ pid }] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      rowHeld(pid);
      await released;
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
  async function queued(count: number) {
    const pid = await held;
    await vi.waitFor(
      async () => {
        const [{ waiting }] = await db.$queryRaw<{ waiting: number }[]>`
          WITH RECURSIVE chain AS (
            SELECT a.pid FROM pg_stat_activity a
            WHERE ${pid}::int = ANY (pg_blocking_pids(a.pid))
            UNION
            SELECT a.pid FROM pg_stat_activity a
            JOIN chain c ON c.pid = ANY (pg_blocking_pids(a.pid))
          )
          SELECT count(*)::int AS waiting FROM chain`;
        expect(waiting).toBeGreaterThanOrEqual(count);
      },
      { timeout: 15_000, interval: 50 },
    );
  }
  return { held, queued, release, done };
}

describe("deletion under concurrency (held rows, either order, no 40P01)", () => {
  // Starts `first`, waits until it queues behind the held row, then `second`.
  async function inOrder<A, B>(
    held: ReturnType<typeof holdRow>,
    first: () => Promise<A>,
    second: () => Promise<B>,
  ): Promise<[A, B]> {
    await held.held;
    const a = first();
    await held.queued(1);
    const b = second();
    await held.queued(2);
    held.release();
    await held.done;
    return [await a, await b];
  }

  test.each(["approve first", "delete first"] as const)(
    "self-delete vs approve on the member's item, %s: nothing stays requested or approved",
    async (order) => {
      const member = await scope.createTestUser();
      const borrower = await scope.createTestUser();
      const { id, itemId } = await loanIn(
        member.id,
        borrower.id,
        stateOf("requested"),
      );
      const approve = () => approveLoanRequest(member.id, id, TODAY);
      const deleteIt = () => deleteOwnUser(member.id, TODAY);

      const held = holdRow("item", itemId);
      if (order === "approve first") {
        expect(await inOrder(held, approve, deleteIt)).toEqual([
          "approved",
          "deleted",
        ]);
        expect(await loanRow(id)).toMatchObject({
          status: "cancelled",
          systemReason: "account_deleted",
        });
      } else {
        expect(await inOrder(held, deleteIt, approve)).toEqual([
          "deleted",
          "stale",
        ]);
        expect(await loanRow(id)).toMatchObject({
          status: "declined",
          systemReason: "account_deleted",
        });
      }
      expect(await itemRow(itemId)).toMatchObject({
        status: "retired",
        ownerId: null,
      });
    },
  );

  test.each(["hand over first", "delete first"] as const)(
    "self-delete as borrower vs the owner's handover, %s: the account stays only while holding the item",
    async (order) => {
      const owner = await scope.createTestUser();
      const member = await scope.createTestUser();
      const { id: itemId } = await scope.createItem({
        ownerId: owner.id,
        status: "listed",
      });
      const { id } = await scope.createLoan({
        itemId,
        borrowerId: member.id,
        status: "approved",
        startDate: TODAY,
        endDate: addDays(TODAY, 2),
      });
      const handOver = () => handOverLoan(owner.id, id, TODAY);
      const deleteIt = () => deleteOwnUser(member.id, TODAY);

      const held = holdRow("item", itemId);
      if (order === "hand over first") {
        expect(await inOrder(held, handOver, deleteIt)).toEqual([
          "handedOver",
          "holdingItem",
        ]);
        expect(await loanRow(id)).toMatchObject({
          status: "out",
          borrowerId: member.id,
        });
        expect(await userGone(member.id)).toBe(false);
      } else {
        expect(await inOrder(held, deleteIt, handOver)).toEqual([
          "deleted",
          "stale",
        ]);
        expect(await loanRow(id)).toMatchObject({
          status: "cancelled",
          systemReason: "account_deleted",
          borrowerId: null,
        });
      }
    },
  );

  test("the last two organizers deleting themselves at once: exactly one is deleted", async () => {
    const a = await scope.createTestUser({ role: "organizer" });
    const b = await scope.createTestUser({ role: "organizer" });
    organizerView.only = [a.id, b.id];

    // Either may win; both must be queued on the organizer locks first.
    const held = holdRow("user", a.id);
    await held.held;
    const both = Promise.all([
      deleteOwnUser(a.id, TODAY),
      deleteOwnUser(b.id, TODAY),
    ]);
    await held.queued(2);
    held.release();
    await held.done;
    const outcomes = await both;

    expect([...outcomes].sort()).toEqual(["deleted", "lastOrganizer"]);
    expect([await userGone(a.id), await userGone(b.id)]).toEqual(
      outcomes[0] === "deleted" ? [true, false] : [false, true],
    );
  });

  test.each(["close first", "delete first"] as const)(
    "deleteMember vs an organizer close of the target's out loan, %s",
    async (order) => {
      const deleter = await scope.createTestUser({ role: "organizer" });
      const closer = await scope.createTestUser({ role: "organizer" });
      const target = await scope.createTestUser({ status: "suspended" });
      const borrower = await scope.createTestUser();
      const { id, itemId } = await loanIn(
        target.id,
        borrower.id,
        stateOf("out"),
      );
      const close = () =>
        closeLoanByOrganizer(
          closer.id,
          { id, returnedOn: TODAY, asLent: "yes", note: "Back in the shed" },
          TODAY,
        );
      const deleteIt = () => deleteOther(deleter.id, target.id);

      // Not an organizer's row: other files queue on those, which would count
      // as waiters here. The first contender waits on the item holding every
      // organizer lock, so the second queues behind it.
      const held = holdRow("item", itemId);
      if (order === "close first") {
        expect(await inOrder(held, close, deleteIt)).toEqual([
          "closed",
          "deleted",
        ]);
        expect(await userGone(target.id)).toBe(true);
        expect(await itemRow(itemId)).toMatchObject({
          status: "retired",
          ownerId: null,
        });
      } else {
        expect(await inOrder(held, deleteIt, close)).toEqual([
          "itemOut",
          "closed",
        ]);
        expect(await userGone(target.id)).toBe(false);
      }
      expect(await loanRow(id)).toMatchObject({
        status: "returned",
        closedById: closer.id,
      });
    },
  );

  test.each(["grant first", "delete first"] as const)(
    "self-delete vs a reset link for the member, %s: no grant outlives them",
    async (order) => {
      const actor = await scope.createTestUser({ role: "organizer" });
      const member = await scope.createTestUser();
      const grant = () =>
        insertResetGrant({
          userId: member.id,
          createdById: actor.id,
          tokenHash: createLinkToken().tokenHash,
        });
      const deleteIt = () => deleteOwnUser(member.id, TODAY);

      // The member's row, after the organizer locks in both: the second
      // contender queues behind the first's.
      const held = holdRow("user", member.id);
      if (order === "grant first") {
        expect(await inOrder(held, grant, deleteIt)).toEqual([
          { kind: "created", displayName: "Mira K." },
          "deleted",
        ]);
      } else {
        expect(await inOrder(held, deleteIt, grant)).toEqual([
          "deleted",
          { kind: "memberGone" },
        ]);
      }
      expect(await userGone(member.id)).toBe(true);
      expect(
        await db.passwordResetGrant.count({ where: { userId: member.id } }),
      ).toBe(0);
    },
  );

  test.each(["reset first", "delete first"] as const)(
    "self-delete vs a reset through the member's grant, %s",
    async (order) => {
      const member = await scope.createTestUser();
      const { id: grantId, token } = await scope.createResetGrant({
        userId: member.id,
      });
      const reset = () =>
        resetPasswordThroughGrant({
          tokenHash: hashLinkToken(token),
          password: "another-horse-battery",
        });
      const deleteIt = () => deleteOwnUser(member.id, TODAY);

      const held = holdGrant(grantId);
      if (order === "reset first") {
        expect(await inOrder(held, reset, deleteIt)).toEqual([
          { kind: "reset", userId: member.id },
          "deleted",
        ]);
      } else {
        expect(await inOrder(held, deleteIt, reset)).toEqual([
          "deleted",
          { kind: "invalidToken" },
        ]);
      }
      expect(await userGone(member.id)).toBe(true);
      expect(
        await db.passwordResetGrant.findUnique({ where: { id: grantId } }),
      ).toBeNull();
    },
  );
});
