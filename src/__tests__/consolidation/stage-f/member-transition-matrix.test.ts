import { refresh } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { redirect } from "next/navigation";
import { inventoryRows } from "@/__tests__/support/action-inventory";
import { LIFECYCLE_EDGES } from "@/__tests__/support/lifecycle-edges";
import { createSession, viewerOf } from "@/__tests__/support/member-fixtures";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import {
  deleteMember,
  demoteMember,
  promoteMember,
  reinstateMember,
  suspendMember,
} from "@/actions/members";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { MemberStatus, Role } from "@/generated/prisma/enums";
import { setFlash } from "@/lib/feedback/flash";
import type { ViewerDTO } from "@/types/viewer";

vi.mock(
  "next/cache",
  async () => (await import("@/__tests__/support/next-cache")).nextCacheModule,
);
vi.mock("next/navigation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/navigation")>();
  return { ...actual, redirect: vi.fn(actual.redirect) };
});
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/lib/feedback/flash", () => ({ setFlash: vi.fn() }));
vi.mock(
  "@/lib/storage/storage",
  async () =>
    (await import("@/__tests__/support/photo-storage")).photoStorageModule,
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

// Every organizer member transition × target role × target status (spec 24):
// the action accepts exactly the Member Lifecycle's cells, and a refusal is
// stale, writes nothing and fires no signal. A second active organizer means no
// cell is a last-organizer cell (stage-e/organizer-guard-matrix (c) owns those),
// and the sweeps belong to stage-e/side-effect-matrix.

type Transition =
  | "promoteMember"
  | "demoteMember"
  | "suspendMember"
  | "reinstateMember"
  | "deleteMember";

const TRANSITIONS: Transition[] = [
  "promoteMember",
  "demoteMember",
  "suspendMember",
  "reinstateMember",
  "deleteMember",
];
const ROLES = Object.values(Role);
const STATUSES = Object.values(MemberStatus);

// The Member Lifecycle and the inventory's Auth cells. The target has nothing
// out, so a suspended target can be deleted.
function accepts(transition: Transition, role: Role, status: MemberStatus) {
  switch (transition) {
    case "promoteMember":
      return role === "member" && status === "active";
    case "demoteMember":
      return role === "organizer" && status === "active";
    case "suspendMember":
      return status === "active";
    case "reinstateMember":
    case "deleteMember":
      return status === "suspended";
  }
}

const AFTER: Record<
  Exclude<Transition, "deleteMember">,
  { field: "role" | "status"; value: string; flash: string }
> = {
  promoteMember: { field: "role", value: "organizer", flash: "memberPromoted" },
  demoteMember: { field: "role", value: "member", flash: "memberDemoted" },
  suspendMember: {
    field: "status",
    value: "suspended",
    flash: "memberSuspended",
  },
  reinstateMember: {
    field: "status",
    value: "active",
    flash: "memberReinstated",
  },
};

const scope = createTestScope();
let actor: ViewerDTO;

beforeAll(async () => {
  await assertMigrated();
  const [acting] = await Promise.all([
    scope.createTestUser({ name: "Ruth K.", role: "organizer" }),
    scope.createTestUser({ name: "Ana V.", role: "organizer" }),
  ]);
  actor = viewerOf(acting.id, "organizer");
});
beforeEach(() => {
  vi.mocked(getViewer).mockResolvedValue(actor);
});
afterAll(async () => {
  await scope.cleanup();
});

const idForm = (id: string) => {
  const data = new FormData();
  data.set("id", id);
  return data;
};

type Run = { state?: object; redirectedTo?: string };

async function run(transition: Transition, memberId: string): Promise<Run> {
  const data = idForm(memberId);
  try {
    switch (transition) {
      case "promoteMember":
        return { state: await promoteMember({}, data) };
      case "demoteMember":
        return { state: await demoteMember({}, data) };
      case "suspendMember":
        return { state: await suspendMember({}, data) };
      case "reinstateMember":
        return { state: await reinstateMember({}, data) };
      case "deleteMember":
        return { state: await deleteMember({}, data) };
    }
  } catch (error) {
    if (!isRedirectError(error)) throw error;
    return { redirectedTo: vi.mocked(redirect).mock.calls[0]?.[0] };
  }
}

const footprint = async (memberId: string) => ({
  user: await db.user.findUnique({ where: { id: memberId } }),
  sessions: await db.session.findMany({
    where: { userId: memberId },
    orderBy: { id: "asc" },
  }),
});

describe("the derived dimensions", () => {
  test("the transitions are the Member Lifecycle's actions that take memberIdSchema", () => {
    const drivers = new Set(
      LIFECYCLE_EDGES.flatMap(({ lifecycle, driver }) =>
        lifecycle === "member" && driver.kind === "action"
          ? [driver.action]
          : [],
      ),
    );
    expect(
      inventoryRows()
        .filter(
          ({ name, input }) =>
            drivers.has(name) && input.startsWith("`memberIdSchema`"),
        )
        .map(({ name }) => name)
        .sort(),
    ).toEqual([...TRANSITIONS].sort());
  });

  test("5 transitions × 2 roles × 2 statuses = 20 cells", () => {
    expect([...ROLES].sort()).toEqual(["member", "organizer"]);
    expect([...STATUSES].sort()).toEqual(["active", "suspended"]);
    expect(TRANSITIONS.length * ROLES.length * STATUSES.length).toBe(20);
  });
});

describe.each(TRANSITIONS)("%s", (transition) => {
  const cells = ROLES.flatMap((role) =>
    STATUSES.map((status) => ({ role, status })),
  );

  test.each(cells)("on an $status $role", async ({ role, status }) => {
    // A fresh target per cell, with a live session so a revocation shows.
    const { id } = await scope.createTestUser({ name: "Sam S.", role, status });
    await createSession(id);
    const before = await footprint(id);
    expect(before.sessions).toHaveLength(1);

    const result = await run(transition, id);
    const after = await footprint(id);

    if (!accepts(transition, role, status)) {
      expect(result).toEqual({ state: { formError: "stale" } });
      expect(after).toEqual(before);
      expect(refresh).not.toHaveBeenCalled();
      expect(setFlash).not.toHaveBeenCalled();
      expect(redirect).not.toHaveBeenCalled();
      return;
    }

    if (transition === "deleteMember") {
      expect(result).toEqual({ redirectedTo: "/admin/members" });
      expect(setFlash).toHaveBeenCalledExactlyOnceWith("memberDeleted");
      expect(refresh).not.toHaveBeenCalled();
      expect(after).toEqual({ user: null, sessions: [] });
      return;
    }

    const { field, value, flash } = AFTER[transition];
    expect(result).toEqual({ state: { flash } });
    expect(refresh).toHaveBeenCalledOnce();
    expect(setFlash).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(after.user?.[field]).toBe(value);
    // Only the diagram's field moves.
    const other = field === "role" ? "status" : "role";
    expect(after.user?.[other]).toBe(before.user?.[other]);
    if (transition === "suspendMember") expect(after.sessions).toEqual([]);
  });
});
