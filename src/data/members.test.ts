import { holdRow } from "@/__tests__/support/hold-row";
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
  insertLoanRequest,
  markLoanBack,
} from "@/data/loans";
import { db } from "@/db";
import { hashLinkToken } from "@/lib/auth/link-tokens";
import { addDays, communityToday } from "@/lib/dates/dates";
import { people } from "@/strings/people";
import {
  changeMemberRole,
  getAdminMemberDetail,
  getAdminMembers,
  reinstateMemberAccount,
  suspendMemberAccount,
  toAdminMemberDetailDTO,
} from "./members";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const TODAY = communityToday();

beforeAll(assertMigrated);
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
