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
import {
  changeMemberRole,
  deleteMemberAccount,
  getAdminMemberDetail,
  reinstateMemberAccount,
  suspendMemberAccount,
} from "@/data/members";
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
    suspendMemberAccount: vi.fn(actual.suspendMemberAccount),
    reinstateMemberAccount: vi.fn(actual.reinstateMemberAccount),
    deleteMemberAccount: vi.fn(actual.deleteMemberAccount),
  };
});
vi.mock("@/data/reset-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/reset-grants")>();
  return { ...actual, insertResetGrant: vi.fn(actual.insertResetGrant) };
});
// The member controls, as markers the rendered tree can be searched for.
vi.mock("@/components/members/MemberStatusControl", () => ({
  default: ({ change }: { change: string }) =>
    createElement("member-status-control", { "data-change": change }),
}));
vi.mock("@/components/members/RoleChangeButton", () => ({
  default: ({ change }: { change: string }) =>
    createElement("role-change-button", { "data-change": change }),
}));
vi.mock("@/components/members/ResetLinkForm", () => ({
  default: () => createElement("reset-link-form"),
}));
vi.mock("@/components/members/DeleteMemberButton", () => ({
  default: ({ memberId }: { memberId: string }) =>
    createElement("delete-member-button", { "data-member": memberId }),
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
  test("the 'not self' actions in code are promote, demote, reset link, suspend, reinstate and delete", () => {
    expect(notSelf.map(({ name }) => name).sort()).toEqual([
      "createResetLink",
      "deleteMember",
      "demoteMember",
      "promoteMember",
      "reinstateMember",
      "suspendMember",
    ]);
  });

  test.each(notSelf)(
    "$name on your own id: formError self, nothing written, no refresh",
    async ({ file, name }) => {
      const action = await loadAction(file, name);
      const viewer = await actAsOrganizer();
      const { id: invitationId } = await scope.createInvitation({
        createdById: viewer.id,
      });
      const before = {
        user: await db.user.findUniqueOrThrow({ where: { id: viewer.id } }),
        sessions: await scope.sessionsOf(viewer.id),
        invitation: await db.invitation.findUniqueOrThrow({
          where: { id: invitationId },
        }),
        loans: await db.loan.findMany({
          where: {
            OR: [{ borrowerId: viewer.id }, { item: { ownerId: viewer.id } }],
          },
        }),
      };

      expect(await action({}, idForm(viewer.id))).toEqual({
        formError: "self",
      });

      expect({
        user: await db.user.findUniqueOrThrow({ where: { id: viewer.id } }),
        sessions: await scope.sessionsOf(viewer.id),
        invitation: await db.invitation.findUniqueOrThrow({
          where: { id: invitationId },
        }),
        loans: await db.loan.findMany({
          where: {
            OR: [{ borrowerId: viewer.id }, { item: { ownerId: viewer.id } }],
          },
        }),
      }).toEqual(before);
      expect(
        await db.passwordResetGrant.findMany({ where: { userId: viewer.id } }),
      ).toEqual([]);
      expect(changeMemberRole).not.toHaveBeenCalled();
      expect(insertResetGrant).not.toHaveBeenCalled();
      expect(suspendMemberAccount).not.toHaveBeenCalled();
      expect(reinstateMemberAccount).not.toHaveBeenCalled();
      expect(deleteMemberAccount).not.toHaveBeenCalled();
      expect(await db.user.count({ where: { id: viewer.id } })).toBe(1);
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
  test("finds the writers: changeMemberRole, suspendMemberAccount and reinstateMemberAccount", () => {
    const writers = dataFiles.filter(
      (file) => roleOrStatusWrites(parseFile(file)).length > 0,
    );
    expect(writers).toEqual(["src/data/members.ts"]);
    // Named by the declaration around the transaction callback.
    const declaredIn = (node: ts.Node) => {
      let current: ts.Node | undefined = node.parent;
      while (current && !ts.isFunctionDeclaration(current)) {
        current = current.parent;
      }
      return current?.name?.text;
    };
    expect(
      roleOrStatusWrites(parseFile("src/data/members.ts")).map(declaredIn),
    ).toEqual([
      "changeMemberRole",
      "suspendMemberAccount",
      "reinstateMemberAccount",
    ]);
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

// Writes naming an organizer through an FK (spec 19): the close's closedById,
// the retire's retiredById. The write takes a key-share on that organizer's
// row, which a role change holds FOR UPDATE, so the writer locks the
// organizers first (rules/data.md). Any delegate, any write method, or raw SQL.
const ORGANIZER_FKS = /\b(closedById|retiredById)\b/;
const FK_WRITE_CALLS = new Set([...WRITE_CALLS, "create", "createMany"]);

function setsOrganizerFk(node: ts.Node | undefined): boolean {
  if (!node || !ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((property) => {
    const name = property.name?.getText() ?? "";
    if (ORGANIZER_FKS.test(name)) return true;
    return (
      (name === "data" || name === "create" || name === "update") &&
      ts.isPropertyAssignment(property) &&
      setsOrganizerFk(property.initializer)
    );
  });
}

function organizerFkWrites(source: ts.SourceFile): ts.Node[] {
  const writes: ts.Node[] = [];
  for (const call of callsIn(source)) {
    const callee = call.expression;
    if (
      ts.isPropertyAccessExpression(callee) &&
      FK_WRITE_CALLS.has(callee.name.text) &&
      setsOrganizerFk(call.arguments[0])
    ) {
      writes.push(call);
    }
  }
  walk(source, (node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      /\b(UPDATE|INSERT)\b/i.test(node.template.getText()) &&
      ORGANIZER_FKS.test(node.template.getText())
    ) {
      writes.push(node);
    }
  });
  return writes;
}

function unlockedFkWrites(source: ts.SourceFile): string[] {
  const calls = callsIn(source);
  return organizerFkWrites(source)
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

describe("lock-first: closedById and retiredById writes take the organizer locks first", () => {
  test("finds the writers: closeLoanByOrganizer and retireItemByOrganizer", () => {
    const declaredIn = (node: ts.Node) => {
      let current: ts.Node | undefined = node.parent;
      while (current && !ts.isFunctionDeclaration(current)) {
        current = current.parent;
      }
      return current?.name?.text;
    };
    const writers = dataFiles.flatMap((file) =>
      organizerFkWrites(parseFile(file)).map(
        (write) => `${file}#${declaredIn(write)}`,
      ),
    );
    expect(writers.sort()).toEqual([
      "src/data/items.ts#retireItemByOrganizer",
      "src/data/loans.ts#closeLoanByOrganizer",
    ]);
  });

  test.each(dataFiles)(
    "%s writes closedById or retiredById only after lockActiveOrganizerIds",
    (file) => {
      expect(unlockedFkWrites(parseFile(file))).toEqual([]);
    },
  );

  test("the check catches a write without the lock, or with the lock after it", () => {
    const probe = (code: string) =>
      unlockedFkWrites(
        ts.createSourceFile("probe.ts", code, ts.ScriptTarget.Latest, true),
      );
    expect(
      probe(
        `async function f(tx) { await tx.loan.update({ where: {}, data: { status: "returned", closedById: a } }); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `async function f(tx) { await tx.item.update({ data: { retiredById: a } }); await lockActiveOrganizerIds(tx); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        'async function f(tx) { await tx.$executeRaw`UPDATE item SET "retiredById" = ${a}`; }',
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `async function f(tx) { await lockActiveOrganizerIds(tx); await tx.loan.update({ data: { closedById: a } }); }`,
      ),
    ).toEqual([]);
    expect(
      probe(
        `async function f(tx) { await tx.item.update({ data: { retiredNote: "x" } }); }`,
      ),
    ).toEqual([]);
  });
});

// Deletes of `user` rows (spec 20): the cascade's SET NULLs and the row lock
// itself meet a role change, which holds every active organizer FOR UPDATE, so
// the deleter locks the organizers first (rules/data.md). One level of
// indirection is accepted, because the deletion's steps 3–9 live in the
// private runAccountDeletion while its two callers (deleteOwnUser,
// deleteMemberAccount) take the locks: a non-exported function whose every
// call site in the file follows lockActiveOrganizerIds in the caller's own
// function. An exported deleter must lock itself.
function userDeletes(source: ts.SourceFile): ts.Node[] {
  const deletes: ts.Node[] = callsIn(source).filter((call) => {
    const callee = call.expression;
    return (
      ts.isPropertyAccessExpression(callee) &&
      (callee.name.text === "delete" || callee.name.text === "deleteMany") &&
      ts.isPropertyAccessExpression(callee.expression) &&
      callee.expression.name.text === "user"
    );
  });
  walk(source, (node) => {
    if (
      ts.isTaggedTemplateExpression(node) &&
      /DELETE\s+FROM\s+"user"/i.test(node.template.getText())
    ) {
      deletes.push(node);
    }
  });
  return deletes;
}

function privateFunctionName(fn: ts.Node): string | null {
  if (!ts.isFunctionDeclaration(fn) || !fn.name) return null;
  const exported = ts
    .getModifiers(fn)
    ?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
  return exported ? null : fn.name.text;
}

function unlockedUserDeletes(source: ts.SourceFile): string[] {
  const calls = callsIn(source);
  const lockedBefore = (node: ts.Node) =>
    calls.some(
      (call) =>
        calleeName(call) === "lockActiveOrganizerIds" &&
        enclosingFunction(call) === enclosingFunction(node) &&
        call.getStart() < node.getStart(),
    );
  return userDeletes(source)
    .filter((deletion) => {
      if (lockedBefore(deletion)) return false;
      const name = privateFunctionName(enclosingFunction(deletion));
      if (!name) return true;
      const sites = calls.filter((call) => calleeName(call) === name);
      return sites.length === 0 || !sites.every(lockedBefore);
    })
    .map((deletion) => deletion.getText().split("\n")[0]);
}

describe("lock-first: user deletes take the organizer locks first", () => {
  test("finds the deleter: runAccountDeletion, reached from deleteOwnUser and deleteMemberAccount", () => {
    const deleters = dataFiles.flatMap((file) =>
      userDeletes(parseFile(file)).map((deletion) => {
        const fn = enclosingFunction(deletion);
        const name = ts.isFunctionDeclaration(fn) ? fn.name?.text : undefined;
        return `${file}#${name}`;
      }),
    );
    expect(deleters).toEqual(["src/data/members.ts#runAccountDeletion"]);
    const callers = callsIn(parseFile("src/data/members.ts"))
      .filter((call) => calleeName(call) === "runAccountDeletion")
      .map((call) => {
        let current: ts.Node | undefined = call.parent;
        while (current && !ts.isFunctionDeclaration(current)) {
          current = current.parent;
        }
        return current?.name?.text;
      });
    expect(callers.sort()).toEqual(["deleteMemberAccount", "deleteOwnUser"]);
  });

  test.each(dataFiles)(
    "%s deletes user rows only after lockActiveOrganizerIds",
    (file) => {
      expect(unlockedUserDeletes(parseFile(file))).toEqual([]);
    },
  );

  test("the check catches a delete without the lock, with the lock after it, or behind an unlocked caller", () => {
    const probe = (code: string) =>
      unlockedUserDeletes(
        ts.createSourceFile("probe.ts", code, ts.ScriptTarget.Latest, true),
      );
    // In the same function.
    expect(
      probe(
        `export async function f(tx) { await tx.user.delete({ where: { id } }); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `export async function f(tx) { await tx.user.deleteMany({}); await lockActiveOrganizerIds(tx); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        'export async function f(tx) { await tx.$executeRaw`DELETE FROM "user" WHERE id = ${id}`; }',
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `export async function f(tx) { await lockActiveOrganizerIds(tx); await tx.user.delete({ where: { id } }); }`,
      ),
    ).toEqual([]);
    // One level through a private helper.
    const helper = `async function run(tx) { await tx.user.delete({ where: { id } }); }`;
    expect(
      probe(
        `${helper} export async function a(tx) { await lockActiveOrganizerIds(tx); await run(tx); }`,
      ),
    ).toEqual([]);
    expect(
      probe(
        `${helper} export async function a(tx) { await lockActiveOrganizerIds(tx); await run(tx); } export async function b(tx) { await run(tx); }`,
      ),
    ).toHaveLength(1);
    expect(
      probe(
        `${helper} export async function a(tx) { await run(tx); await lockActiveOrganizerIds(tx); }`,
      ),
    ).toHaveLength(1);
    expect(probe(helper)).toHaveLength(1);
    // An exported helper may be called from anywhere: it must lock itself.
    expect(
      probe(
        `export ${helper} export async function a(tx) { await lockActiveOrganizerIds(tx); await run(tx); }`,
      ),
    ).toHaveLength(1);
    // Other deletes are not user deletes.
    expect(
      probe(
        `export async function f(tx) { await tx.session.deleteMany({}); await tx.item.delete({}); }`,
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
  canDelete: false,
};

async function renderDetail(dto: AdminMemberDetailDTO): Promise<string> {
  const viewer = await actAsOrganizer();
  vi.mocked(getAdminMemberDetail).mockResolvedValueOnce(dto);
  const tree = (await MemberDetailSection({
    params: Promise.resolve({ id: dto.id }),
  })) as ReactNode;
  expect(getAdminMemberDetail).toHaveBeenCalledWith(
    viewer.id,
    dto.id,
    expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  );
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

describe("MemberDetailSection's Access card", () => {
  test("an active member: the suspend control, after the open loans and before Role", async () => {
    const html = await renderDetail(otherMember);
    expect(html).toContain('<member-status-control data-change="suspend">');
    expect(html).toContain(members.accessActiveBody);
    const order = [
      members.loansHeading,
      members.accessHeading,
      members.roleHeading,
      members.resetHeading,
    ].map((heading) => html.indexOf(`>${heading}</h2>`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a suspended member: says so and offers reinstate", async () => {
    const html = await renderDetail({ ...otherMember, status: "suspended" });
    expect(html).toContain('<member-status-control data-change="reinstate">');
    // React's HTML escapes the apostrophe in "can't".
    expect(html).toContain(
      members.accessSuspendedBody.replaceAll("'", "&#x27;"),
    );
  });

  test("the last active organizer: the reason, no control", async () => {
    const html = await renderDetail({
      ...otherMember,
      role: "organizer",
      isLastActiveOrganizer: true,
    });
    expect(html).toContain(`>${members.accessHeading}</h2>`);
    expect(html).not.toContain("<member-status-control");
    expect(html).toContain(members.lastOrganizer);
  });

  test("your own record: no Access card and no suspend or reinstate control", async () => {
    const html = await renderDetail({
      ...otherMember,
      role: "organizer",
      isSelf: true,
    });
    expect(html).not.toContain(`>${members.accessHeading}</h2>`);
    expect(html).not.toContain("<member-status-control");
  });
});

// Spec 20: a suspended, non-self member only; the control only with nothing out.
describe("MemberDetailSection's Delete account card", () => {
  const suspended = { ...otherMember, status: "suspended" as const };

  test("a suspended member with nothing out: the delete control, after Access and before Role", async () => {
    const html = await renderDetail({ ...suspended, canDelete: true });
    expect(html).toContain('<delete-member-button data-member="member-2">');
    expect(html).toContain(members.deleteBody.replaceAll("'", "&#x27;"));
    expect(html).not.toContain(members.deleteStillOut);
    const order = [
      members.loansHeading,
      members.accessHeading,
      members.deleteHeading,
      members.roleHeading,
      members.resetHeading,
    ].map((heading) => html.indexOf(`>${heading}</h2>`));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  test("a suspended member with something out: the reason, no control", async () => {
    const html = await renderDetail({ ...suspended, canDelete: false });
    expect(html).toContain(`>${members.deleteHeading}</h2>`);
    expect(html).toContain(members.deleteStillOut);
    expect(html).not.toContain("<delete-member-button");
  });

  test("an active member: no Delete account card", async () => {
    const html = await renderDetail(otherMember);
    expect(html).not.toContain(`>${members.deleteHeading}</h2>`);
    expect(html).not.toContain("<delete-member-button");
  });

  test("your own record: no Delete account card, even when suspended and deletable", async () => {
    const html = await renderDetail({
      ...suspended,
      isSelf: true,
      canDelete: true,
    });
    expect(html).not.toContain(`>${members.deleteHeading}</h2>`);
    expect(html).not.toContain("<delete-member-button");
  });
});
