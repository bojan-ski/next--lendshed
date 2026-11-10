import { isRedirectError } from "next/dist/client/components/redirect-error";
import ts from "typescript";
import {
  isUseServerModule,
  parseFile,
  readSource,
  sourceFiles,
} from "@/__tests__/support/import-graph";
import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { db } from "@/db";
import { auth } from "@/lib/auth/auth";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

// The actions anyone may call. Must equal the inventory's `public` and
// `public (token)` rows that exist in code; anything else needs a session.
const PUBLIC_ACTIONS = [
  "signIn",
  "joinWithInvitation",
  "resetPasswordWithGrant",
];

type Action = (...args: unknown[]) => Promise<unknown>;
type InventoryRow = { name: string; auth: string };

// Every exported name of every "use server" module under src/actions/.
function serverActionExports(): { file: string; name: string }[] {
  return sourceFiles("src/actions/**/*.ts")
    .filter((file) => !file.endsWith(".test.ts"))
    .map((file) => ({ file, source: parseFile(file) }))
    .filter(({ source }) => isUseServerModule(source))
    .flatMap(({ file, source }) =>
      source.statements.flatMap((statement) => {
        const exported = ts
          .getModifiers(statement as ts.HasModifiers)
          ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
        if (exported && ts.isFunctionDeclaration(statement) && statement.name) {
          return [{ file, name: statement.name.text }];
        }
        if (exported && ts.isVariableStatement(statement)) {
          return statement.declarationList.declarations.map((declaration) => ({
            file,
            name: declaration.name.getText(source),
          }));
        }
        if (ts.isExportDeclaration(statement) && !statement.isTypeOnly) {
          throw new Error(`${file}: re-exports hide actions from this sweep`);
        }
        return [];
      }),
    );
}

// The rows of the first table under "### Server Actions" in project-data.md. A
// name cell may hold several actions ("`promoteMember` / `demoteMember`"):
// each becomes its own row with the shared auth cell.
function inventoryRows(): InventoryRow[] {
  const document = readSource("context/project-data.md");
  const section = document.split("### Server Actions")[1] ?? "";
  const rows: InventoryRow[] = [];
  for (const line of section.split("\n")) {
    if (line.startsWith("### ")) break;
    const cells = line.split("|").map((cell) => cell.trim());
    if (!/^`\w+`( \/ `\w+`)*$/.test(cells[1] ?? "")) continue;
    for (const [, name] of cells[1].matchAll(/`(\w+)`/g)) {
      rows.push({ name, auth: cells[3] });
    }
  }
  return rows;
}

// The role an auth cell leads with: "organizer, not self; …" → "organizer".
const leadingRole = (auth: string) => auth.split(/[,;]/)[0].trim();

const exported = serverActionExports();
const inventory = inventoryRows();
const exportedNames = exported.map(({ name }) => name).sort();
const isPublic = (row: InventoryRow) =>
  row.auth === "public" || row.auth === "public (token)";

// Through the @/ alias, so the action shares this file's mocked and spied modules.
async function loadAction(file: string, name: string): Promise<Action> {
  const specifier = `@/${file.replace(/^src\//, "").replace(/\.ts$/, "")}`;
  const actions = await import(/* @vite-ignore */ specifier);
  return actions[name] as Action;
}

async function thrownBy(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

function redirectTargetOf(error: unknown): string {
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

describe("action enforcement — derivation", () => {
  test("the inventory parses", () => {
    expect(inventory.length).toBeGreaterThanOrEqual(2);
    expect(inventory.map(({ name }) => name)).toContain("signOut");
  });

  test("the built actions are exactly the expected set", () => {
    expect(exportedNames).toEqual([
      "changePassword",
      "createInvitation",
      "createResetLink",
      "demoteMember",
      "joinWithInvitation",
      "promoteMember",
      "resetPasswordWithGrant",
      "revokeInvitation",
      "signIn",
      "signOut",
      "updateContactDetails",
      "updateProfile",
    ]);
  });

  test("a name cell with several actions yields one row per action", () => {
    const promote = inventory.find(({ name }) => name === "promoteMember");
    const demote = inventory.find(({ name }) => name === "demoteMember");
    expect(promote?.auth).toMatch(/^organizer, not self/);
    expect(demote?.auth).toBe(promote?.auth);
  });

  test("every exported action has an inventory row", () => {
    const rowNames = new Set(inventory.map(({ name }) => name));
    expect(exportedNames.filter((name) => !rowNames.has(name))).toEqual([]);
  });

  test("PUBLIC_ACTIONS equals the inventory's public rows present in code", () => {
    const publicInCode = inventory
      .filter((row) => isPublic(row) && exportedNames.includes(row.name))
      .map(({ name }) => name)
      .sort();
    expect([...PUBLIC_ACTIONS].sort()).toEqual(publicInCode);
  });

  test("every exported action is a function", async () => {
    for (const { file, name } of exported) {
      expect(typeof (await loadAction(file, name)), name).toBe("function");
    }
  });
});

const guarded = exported.filter(({ name }) => !PUBLIC_ACTIONS.includes(name));

describe.each(guarded)("$name without a valid session", ({ file, name }) => {
  test("redirects to /login before reaching the library or writing", async () => {
    const action = await loadAction(file, name);
    const user = await scope.createTestUser();
    const ip = scope.ip();
    await signInForCookie({ ...user, ip });
    const before = {
      sessions: await scope.sessionsOf(user.id),
      accounts: await db.account.findMany({ where: { userId: user.id } }),
      rateLimits: await scope.rateLimitRows(),
    };

    // getViewer's session read is the guard itself; every other library entry
    // point must stay untouched (the library refuses forged cookies on its own).
    const handler = vi.spyOn(auth, "handler");
    const apiSpies = Object.entries(auth.api)
      .filter(
        ([key, value]) => key !== "getSession" && typeof value === "function",
      )
      .map(([key]) => vi.spyOn(auth.api, key as keyof typeof auth.api));

    const forged: Record<string, string>[] = [
      {},
      { [SESSION_COOKIE]: "forged.signature" },
    ];
    for (const cookies of forged) {
      mockNextRequest({ ip, cookies });
      const error = await thrownBy(action({}, new FormData()));
      expect(redirectTargetOf(error)).toBe("/login");
    }

    expect(handler).not.toHaveBeenCalled();
    for (const spy of apiSpies) expect(spy).not.toHaveBeenCalled();
    expect({
      sessions: await scope.sessionsOf(user.id),
      accounts: await db.account.findMany({ where: { userId: user.id } }),
      rateLimits: await scope.rateLimitRows(),
    }).toEqual(before);
  });
});

describe("signIn is public", () => {
  test("an anonymous call with invalid credentials writes no session", async () => {
    const action = await loadAction("src/actions/auth.ts", "signIn");
    const user = await scope.createTestUser();
    mockNextRequest({ ip: scope.ip() });
    const form = new FormData();
    form.set("email", user.email);
    form.set("password", `${user.password}-wrong`);

    const state = await action({}, form);

    expect(state).toMatchObject({ formError: "invalidCredentials" });
    expect(await scope.sessionsOf(user.id)).toEqual([]);
  });
});

describe("joinWithInvitation is public", () => {
  test("an anonymous join with an unknown token writes nothing", async () => {
    const action = await loadAction(
      "src/actions/invitations.ts",
      "joinWithInvitation",
    );
    const email = scope.email();
    mockNextRequest({ ip: scope.ip() });
    const form = new FormData();
    for (const [name, value] of Object.entries({
      token: "A".repeat(43),
      name: "Mira K.",
      email,
      password: "correct-horse-battery",
      acceptHouseRules: "on",
    })) {
      form.set(name, value);
    }

    expect(await action({}, form)).toEqual({ linkBroken: true });
    expect(await db.user.count({ where: { email } })).toBe(0);
  });
});

describe("resetPasswordWithGrant is public", () => {
  test("an anonymous reset with an unknown token writes nothing", async () => {
    const action = await loadAction(
      "src/actions/reset.ts",
      "resetPasswordWithGrant",
    );
    const member = await scope.createTestUser();
    const ip = scope.ip();
    await signInForCookie({ ...member, ip });
    const hashBefore = await db.account.findFirstOrThrow({
      where: { userId: member.id },
    });
    mockNextRequest({ ip: scope.ip() });
    const form = new FormData();
    form.set("token", "A".repeat(43));
    form.set("password", "a-brand-new-password");

    expect(await action({}, form)).toEqual({ linkBroken: true });
    expect(
      await db.account.findFirstOrThrow({ where: { userId: member.id } }),
    ).toEqual(hashBefore);
    expect(await scope.sessionsOf(member.id)).toHaveLength(1);
  });
});

describe("wrong role", () => {
  // Every exported action whose inventory auth leads with "organizer".
  const organizerOnly = exported.filter(({ name }) =>
    inventory.some(
      (row) => row.name === name && leadingRole(row.auth) === "organizer",
    ),
  );

  test("the organizer-only actions in code are the invitation and member actions", () => {
    expect(organizerOnly.map(({ name }) => name).sort()).toEqual([
      "createInvitation",
      "createResetLink",
      "demoteMember",
      "promoteMember",
      "revokeInvitation",
    ]);
  });

  describe.each(organizerOnly)("$name called by a member", ({ file, name }) => {
    test("gets not-found and writes or changes no invitation, role or grant", async () => {
      const action = await loadAction(file, name);
      const member = await scope.createTestUser({ role: "member" });
      const ip = scope.ip();
      const cookie = await signInForCookie({ ...member, ip });
      const { id: invitationId } = await scope.createInvitation();
      // An organizer target makes a demote meaningful, an active one the rest.
      const target = await scope.createTestUser({ role: "organizer" });
      const before = {
        invitation: await db.invitation.findUniqueOrThrow({
          where: { id: invitationId },
        }),
        target: await db.user.findUniqueOrThrow({ where: { id: target.id } }),
      };
      mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
      const form = new FormData();
      form.set("id", file.endsWith("members.ts") ? target.id : invitationId);
      form.set("note", "from a member");

      const error = await thrownBy(action({}, form));

      expect(isRedirectError(error)).toBe(false);
      expect((error as { digest?: string }).digest).toBe(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
      expect(
        await db.invitation.count({ where: { createdById: member.id } }),
      ).toBe(0);
      expect(
        await db.invitation.findUniqueOrThrow({ where: { id: invitationId } }),
      ).toEqual(before.invitation);
      expect(
        await db.user.findUniqueOrThrow({ where: { id: target.id } }),
      ).toEqual(before.target);
      expect(
        await db.passwordResetGrant.count({
          where: { OR: [{ userId: target.id }, { createdById: member.id }] },
        }),
      ).toBe(0);
    });
  });
});
