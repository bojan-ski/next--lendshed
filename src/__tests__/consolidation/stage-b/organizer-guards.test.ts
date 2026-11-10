import { refresh } from "next/cache";
import { createElement, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import ts from "typescript";
import {
  inventoryRows,
  serverActionExports,
} from "@/__tests__/support/action-inventory";
import {
  callsIn,
  calleeName,
  enclosingFunction,
  walk,
} from "@/__tests__/support/ast";
import { parseFile, sourceFiles } from "@/__tests__/support/import-graph";
import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { demoteMember } from "@/actions/members";
import MemberDetailSection from "@/components/members/MemberDetailSection";
import { changeMemberRole, getAdminMemberDetail } from "@/data/members";
import { insertResetGrant } from "@/data/reset-grants";
import { db } from "@/db";
import { members } from "@/strings/members";
import type { AdminMemberDetailDTO } from "@/types/members";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/members")>();
  return {
    ...actual,
    changeMemberRole: vi.fn(actual.changeMemberRole),
    getAdminMemberDetail: vi.fn(actual.getAdminMemberDetail),
  };
});
vi.mock("@/data/reset-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/reset-grants")>();
  return { ...actual, insertResetGrant: vi.fn(actual.insertResetGrant) };
});
// The two member controls, as markers the rendered tree can be searched for.
vi.mock("@/components/members/RoleChangeButton", () => ({
  default: ({ change }: { change: string }) =>
    createElement("role-change-button", { "data-change": change }),
}));
vi.mock("@/components/members/ResetLinkForm", () => ({
  default: () => createElement("reset-link-form"),
}));

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function idForm(id: string): FormData {
  const data = new FormData();
  data.set("id", id);
  return data;
}

// A fresh organizer, signed in as the request's viewer.
async function actAsOrganizer() {
  const user = await scope.createTestUser({ role: "organizer" });
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return user;
}

type Action = (prev: object, formData: FormData) => Promise<unknown>;

// Inventory rows whose auth says "not self", for actions that exist in code
// (the inventory already holds rows for later specs).
const exported = serverActionExports();
const notSelf = inventoryRows()
  .filter(({ auth }) => auth.includes("not self"))
  .flatMap(({ name }) => exported.filter((action) => action.name === name));

async function loadAction(file: string, name: string): Promise<Action> {
  const specifier = `@/${file.replace(/^src\//, "").replace(/\.ts$/, "")}`;
  const actions = await import(/* @vite-ignore */ specifier);
  return actions[name] as Action;
}

describe("organizer actions never target yourself", () => {
  test("the 'not self' actions in code are promote, demote and reset link", () => {
    expect(notSelf.map(({ name }) => name).sort()).toEqual([
      "createResetLink",
      "demoteMember",
      "promoteMember",
    ]);
  });

  test.each(notSelf)(
    "$name on your own id: formError self, nothing written, no refresh",
    async ({ file, name }) => {
      const action = await loadAction(file, name);
      const viewer = await actAsOrganizer();
      const before = await db.user.findUniqueOrThrow({
        where: { id: viewer.id },
      });

      expect(await action({}, idForm(viewer.id))).toEqual({
        formError: "self",
      });

      expect(
        await db.user.findUniqueOrThrow({ where: { id: viewer.id } }),
      ).toEqual(before);
      expect(
        await db.passwordResetGrant.findMany({ where: { userId: viewer.id } }),
      ).toEqual([]);
      expect(changeMemberRole).not.toHaveBeenCalled();
      expect(insertResetGrant).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
    },
  );
});

describe("the last active organizer", () => {
  // Unreachable against the shared database (the seed keeps two active
  // organizers); the concurrent-demote test in src/data/members.test.ts is the
  // invariant proof, and the lock-first guard below keeps later writers honest.
  test("demoteMember maps lastOrganizer to its state, writes nothing, skips refresh()", async () => {
    await actAsOrganizer();
    const target = await scope.createTestUser({ role: "organizer" });
    vi.mocked(changeMemberRole).mockResolvedValueOnce("lastOrganizer");

    expect(await demoteMember({}, idForm(target.id))).toEqual({
      formError: "lastOrganizer",
    });

    expect(
      await db.user.findUniqueOrThrow({ where: { id: target.id } }),
    ).toMatchObject({ role: "organizer", status: "active" });
    expect(refresh).not.toHaveBeenCalled();
  });
});

// Writes of User.role or User.status on an existing row: Prisma update calls on
// the user delegate whose data sets either field, and raw UPDATEs of "user".
const WRITE_CALLS = new Set([
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
]);

function setsRoleOrStatus(node: ts.Node | undefined): boolean {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => {
    const name = property.name?.getText();
    if (name === "role" || name === "status") return true;
    if (
      (name === "data" || name === "update") &&
      ts.isPropertyAssignment(property)
    ) {
      return setsRoleOrStatus(property.initializer);
    }
    return false;
  });
}

function roleOrStatusWrites(source: ts.SourceFile): ts.Node[] {
  const writes: ts.Node[] = [];
  for (const call of callsIn(source)) {
    const callee = call.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      WRITE_CALLS.has(callee.name.text) &&
      ts.isPropertyAccessExpression(callee.expression) &&
      callee.expression.name.text === "user" &&
      setsRoleOrStatus(call.arguments[0])
    ) {
      writes.push(call);
    }
  }
  walk(source, (node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      /UPDATE\s+"user"[\s\S]*\b(role|status)\b/i.test(node.template.getText())
    ) {
      writes.push(node);
    }
  });
  return writes;
}

function unlockedWrites(source: ts.SourceFile): string[] {
  const calls = callsIn(source);
  return roleOrStatusWrites(source)
    .filter(
      (write) =>
        !calls.some(
          (call) =>
            calleeName(call) === "lockActiveOrganizerIds" &&
            enclosingFunction(call) === enclosingFunction(write) &&
            call.getStart() < write.getStart(),
        ),
    )
    .map((write) => write.getText().split("\n")[0]);
}

const dataFiles = sourceFiles("src/data/**/*.ts").filter(
  (file) => !file.endsWith(".test.ts"),
);

describe("lock-first: role and status writes take the organizer locks first", () => {
  test("finds the Stage B writer: changeMemberRole", () => {
    const writers = dataFiles.filter(
      (file) => roleOrStatusWrites(parseFile(file)).length > 0,
    );
    expect(writers).toEqual(["src/data/members.ts"]);
  });

  test.each(dataFiles)(
    "%s writes role or status only after lockActiveOrganizerIds",
    (file) => {
      expect(unlockedWrites(parseFile(file))).toEqual([]);
    },
  );

  test("the check catches a write without the lock, or with the lock after it", () => {
    const probe = (code: string) =>
      unlockedWrites(
        ts.createSourceFile("probe.ts", code, ts.ScriptTarget.Latest, true),
      );
    expect(
      probe(
        `async function f(tx) { await tx.user.update({ where: {}, data: { status: "suspended" } }); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `async function f(tx) { await tx.user.updateMany({ data: { role: "member" } }); await lockActiveOrganizerIds(tx); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        "async function f(tx) { await tx.$executeRaw`UPDATE \"user\" SET status = 'suspended'`; }",
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `async function f(tx) { await lockActiveOrganizerIds(tx); await tx.user.update({ data: { role: "member" } }); }`,
      ),
    ).toEqual([]);
    expect(
      probe(
        `async function f(tx) { await tx.user.update({ data: { name: "x" } }); }`,
      ),
    ).toEqual([]);
  });
});

// The detail page's controls, rendered from a stubbed DTO.
const otherMember: AdminMemberDetailDTO = {
  id: "member-2",
  displayName: "Ana P.",
  initials: "AP",
  role: "member",
  status: "active",
  openLoanCount: 0,
  area: null,
  memberSince: "2026-11-01",
  openLoans: [],
  isSelf: false,
  isLastActiveOrganizer: false,
};

async function renderDetail(dto: AdminMemberDetailDTO): Promise<string> {
  const viewer = await actAsOrganizer();
  vi.mocked(getAdminMemberDetail).mockResolvedValueOnce(dto);
  const tree = (await MemberDetailSection({
    params: Promise.resolve({ id: dto.id }),
  })) as ReactNode;
  expect(getAdminMemberDetail).toHaveBeenCalledWith(viewer.id, dto.id);
  const { prelude } = await prerender(tree);
  return new Response(prelude).text();
}

describe("MemberDetailSection's role and reset controls", () => {
  test("another active member: promote and reset link (control)", async () => {
    const html = await renderDetail(otherMember);
    expect(html).toContain('<role-change-button data-change="promote">');
    expect(html).toContain("<reset-link-form>");
  });

  test("your own record: no role control and no reset link", async () => {
    const html = await renderDetail({
      ...otherMember,
      role: "organizer",
      isSelf: true,
    });
    expect(html).not.toContain("<role-change-button");
    expect(html).not.toContain("<reset-link-form");
    expect(html).toContain('href="/account"');
    expect(html).toContain(members.ownRecordLink);
  });

  test("a suspended member: no role control, says why; reset link stays", async () => {
    const html = await renderDetail({ ...otherMember, status: "suspended" });
    expect(html).not.toContain("<role-change-button");
    expect(html).toContain(members.roleNeedsActive);
    expect(html).toContain("<reset-link-form>");
  });

  test("the last active organizer: no demote control (reset link stays)", async () => {
    const html = await renderDetail({
      ...otherMember,
      role: "organizer",
      isLastActiveOrganizer: true,
    });
    expect(html).not.toContain("<role-change-button");
    expect(html).toContain("<reset-link-form>");
  });

  test("another organizer who isn't the last: demote (control)", async () => {
    const html = await renderDetail({ ...otherMember, role: "organizer" });
    expect(html).toContain('<role-change-button data-change="demote">');
  });
});
