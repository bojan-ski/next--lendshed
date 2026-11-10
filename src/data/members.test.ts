import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import { communityToday } from "@/lib/dates/dates";
import {
  changeMemberRole,
  getAdminMemberDetail,
  getAdminMembers,
  toAdminMemberDetailDTO,
} from "./members";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();

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

    const rows = await getAdminMembers(scope.tag.toUpperCase());

    expect(rows.map((row) => row.id)).toEqual([ada.id, bo.id, cy.id]);
    expect(rows.map((row) => [row.role, row.status])).toEqual([
      ["organizer", "active"],
      ["member", "suspended"],
      ["member", "active"],
    ]);
  });

  test("an empty search lists everyone, this file's members included", async () => {
    const { cy } = await threeMembers();
    const rows = await getAdminMembers("");
    expect(rows.map((row) => row.id)).toContain(cy.id);
  });

  test("a search with no match is empty", async () => {
    expect(await getAdminMembers(`${scope.tag}-nobody`)).toEqual([]);
  });

  test("rows carry no email, contact details or timestamps", async () => {
    const user = await scope.createTestUser({ name: `${scope.tag} Dee K.` });
    const [row] = await getAdminMembers(`${scope.tag} Dee`);
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
    expect(await getAdminMemberDetail(viewer.id, "no-such-member")).toBeNull();
  });

  test("returns the detail DTO: community-date memberSince, no open loans, no email", async () => {
    const viewer = await scope.createTestUser({ role: "organizer" });
    const member = await scope.createTestUser({ name: "Mira K." });
    await db.user.update({
      where: { id: member.id },
      data: { area: "north end", contactDetails: "07700 900123" },
    });
    const { createdAt } = await userRow(member.id);

    const detail = await getAdminMemberDetail(viewer.id, member.id);

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
    expect(await getAdminMemberDetail(viewer.id, viewer.id)).toMatchObject({
      isSelf: true,
    });
  });

  test("an organizer with another active organizer is not the last one", async () => {
    const viewer = await scope.createTestUser({ role: "organizer" });
    const other = await scope.createTestUser({ role: "organizer" });
    expect(await getAdminMemberDetail(viewer.id, other.id)).toMatchObject({
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
    expect(toAdminMemberDetailDTO(row, "u2", 1).isLastActiveOrganizer).toBe(
      true,
    );
    expect(toAdminMemberDetailDTO(row, "u2", 2).isLastActiveOrganizer).toBe(
      false,
    );
  });

  test("a suspended organizer or a member is never the last active organizer", () => {
    expect(
      toAdminMemberDetailDTO({ ...row, status: "suspended" }, "u2", 1)
        .isLastActiveOrganizer,
    ).toBe(false);
    expect(
      toAdminMemberDetailDTO({ ...row, role: "member" }, "u2", 1)
        .isLastActiveOrganizer,
    ).toBe(false);
  });

  test("memberSince is the community date of createdAt, not the UTC date", () => {
    // 23:30 UTC on the 8th is 00:30 on the 9th in Belgrade (CET).
    expect(toAdminMemberDetailDTO(row, "u2", 2).memberSince).toBe("2026-11-09");
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
