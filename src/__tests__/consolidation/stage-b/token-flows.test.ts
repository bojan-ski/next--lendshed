import type { Metadata } from "next";
import { NextRequest } from "next/server";
import { sourceFiles } from "@/__tests__/support/import-graph";
import { mockNextRequest } from "@/__tests__/support/next-request";
import { routePattern, routeUrl } from "@/__tests__/support/routeParams";
import {
  assertMigrated,
  createTestScope,
  signInForCookie,
  TEST_PASSWORD,
  type InvitationState,
  type ResetGrantState,
} from "@/__tests__/support/test-db";
import { joinWithInvitation } from "@/actions/invitations";
import { resetPasswordWithGrant } from "@/actions/reset";
import { joinThroughInvitation } from "@/data/invitations";
import { resetPasswordThroughGrant } from "@/data/reset-grants";
import { db } from "@/db";
import { createCredentialUser, setCredentialPassword } from "@/db/credentials";
import { createLinkToken } from "@/lib/auth/link-tokens";
import { proxy } from "@/proxy";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
// Spied, not replaced: real queries, real hashing.
vi.mock("@/data/invitations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/invitations")>();
  return {
    ...actual,
    joinThroughInvitation: vi.fn(actual.joinThroughInvitation),
  };
});
vi.mock("@/data/reset-grants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/reset-grants")>();
  return {
    ...actual,
    resetPasswordThroughGrant: vi.fn(actual.resetPasswordThroughGrant),
  };
});
vi.mock("@/db/credentials", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/credentials")>();
  return {
    createCredentialUser: vi.fn(actual.createCredentialUser),
    setCredentialPassword: vi.fn(actual.setCredentialPassword),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const NEW_PASSWORD = "a-brand-new-password";
const MALFORMED = "abc";
const BROKEN = { linkBroken: true };

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// Every way a token action could reach the database: the client's own entry
// points and each delegate it could write through.
const MODELS = [
  "user",
  "account",
  "session",
  "invitation",
  "passwordResetGrant",
] as const;
const OPERATIONS = [
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "create",
  "createMany",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
] as const;

function watchDb() {
  const spies = [
    vi.spyOn(db, "$transaction"),
    vi.spyOn(db, "$queryRaw"),
    vi.spyOn(db, "$executeRaw"),
  ];
  for (const model of MODELS) {
    const delegate = db[model] as unknown as Record<string, unknown>;
    for (const operation of OPERATIONS) {
      if (typeof delegate[operation] === "function") {
        spies.push(vi.spyOn(delegate, operation as never));
      }
    }
  }
  return {
    touched: () => spies.filter((spy) => spy.mock.calls.length > 0).length,
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

type JoinClass = "malformed" | "unknown" | Exclude<InvitationState, "open">;
type ResetClass = "malformed" | "unknown" | Exclude<ResetGrantState, "open">;

const JOIN_CLASSES: JoinClass[] = [
  "malformed",
  "unknown",
  "used",
  "expired",
  "revoked",
];
const RESET_CLASSES: ResetClass[] = [
  "malformed",
  "unknown",
  "used",
  "expired",
  "superseded",
];

const results: unknown[] = [];

describe("joinWithInvitation — every invalid class", () => {
  test.each(JOIN_CLASSES)(
    "%s: exactly { linkBroken: true }, no account, the invitation untouched",
    async (kind) => {
      const invitation =
        kind === "malformed" || kind === "unknown"
          ? null
          : await scope.createInvitation({ state: kind });
      const token =
        kind === "malformed"
          ? MALFORMED
          : (invitation?.token ?? createLinkToken().token);
      const before = invitation
        ? await db.invitation.findUniqueOrThrow({
            where: { id: invitation.id },
          })
        : null;
      const email = scope.email();
      mockNextRequest({ ip: scope.ip() });
      const watch = kind === "malformed" ? watchDb() : null;

      let result: unknown;
      try {
        result = await joinWithInvitation(
          {},
          form({
            token,
            name: "Mira K.",
            email,
            password: TEST_PASSWORD,
            acceptHouseRules: "on",
          }),
        );
      } finally {
        if (watch) {
          expect(watch.touched()).toBe(0);
          watch.restore();
        }
      }

      expect(result).toStrictEqual(BROKEN);
      results.push(result);
      if (kind === "malformed")
        expect(joinThroughInvitation).not.toHaveBeenCalled();
      expect(createCredentialUser).not.toHaveBeenCalled();
      expect(await db.user.findUnique({ where: { email } })).toBeNull();
      if (invitation) {
        expect(
          await db.invitation.findUniqueOrThrow({
            where: { id: invitation.id },
          }),
        ).toEqual(before);
      }
    },
  );
});

describe("resetPasswordWithGrant — every invalid class", () => {
  test.each(RESET_CLASSES)(
    "%s: exactly { linkBroken: true }, password, sessions and grant untouched",
    async (kind) => {
      const target = await scope.createTestUser();
      await signInForCookie({ ...target, ip: scope.ip() });
      const grant =
        kind === "malformed" || kind === "unknown"
          ? null
          : await scope.createResetGrant({ userId: target.id, state: kind });
      const token =
        kind === "malformed"
          ? MALFORMED
          : (grant?.token ?? createLinkToken().token);
      const hash = () =>
        db.account.findFirstOrThrow({
          where: { userId: target.id, providerId: "credential" },
          select: { password: true },
        });
      const hashBefore = await hash();
      const sessionsBefore = await scope.sessionsOf(target.id);
      const grantBefore = grant
        ? await db.passwordResetGrant.findUniqueOrThrow({
            where: { id: grant.id },
          })
        : null;
      mockNextRequest({ ip: scope.ip() });
      const watch = kind === "malformed" ? watchDb() : null;

      let result: unknown;
      try {
        result = await resetPasswordWithGrant(
          {},
          form({ token, password: NEW_PASSWORD }),
        );
      } finally {
        if (watch) {
          expect(watch.touched()).toBe(0);
          watch.restore();
        }
      }

      expect(result).toStrictEqual(BROKEN);
      results.push(result);
      if (kind === "malformed") {
        expect(resetPasswordThroughGrant).not.toHaveBeenCalled();
      }
      expect(setCredentialPassword).not.toHaveBeenCalled();
      expect(await hash()).toEqual(hashBefore);
      expect(await scope.sessionsOf(target.id)).toEqual(sessionsBefore);
      if (grant) {
        expect(
          await db.passwordResetGrant.findUniqueOrThrow({
            where: { id: grant.id },
          }),
        ).toEqual(grantBefore);
      }
    },
  );
});

describe("the database watch", () => {
  // Control: the watch sees a well-formed token reach the database, so a zero
  // for the malformed class above is a real zero.
  test.each([
    [
      "join",
      () =>
        joinWithInvitation(
          {},
          form({
            token: createLinkToken().token,
            name: "Mira K.",
            email: scope.email(),
            password: TEST_PASSWORD,
            acceptHouseRules: "on",
          }),
        ),
    ],
    [
      "reset",
      () =>
        resetPasswordWithGrant(
          {},
          form({
            token: createLinkToken().token,
            password: NEW_PASSWORD,
          }),
        ),
    ],
  ])("sees an unknown %s token reach the database", async (_, submit) => {
    mockNextRequest({ ip: scope.ip() });
    const watch = watchDb();
    try {
      expect(await submit()).toStrictEqual(BROKEN);
      expect(watch.touched()).toBeGreaterThan(0);
    } finally {
      watch.restore();
    }
  });
});

describe("one broken-link state for both flows", () => {
  test("all ten results are identical, with no other key", () => {
    expect(results).toHaveLength(JOIN_CLASSES.length + RESET_CLASSES.length);
    for (const result of results) {
      expect(JSON.stringify(result)).toBe(JSON.stringify(BROKEN));
    }
  });
});

// The token routes: (public) pages taking a `token` param, derived from the tree.
const tokenRoutes = sourceFiles("src/app/**/page.tsx")
  .filter((file) => file.startsWith("src/app/(public)/"))
  .map((file) => ({ file, pattern: routePattern(file) }))
  .filter(({ pattern }) => pattern.includes("[token]"));

describe("token route headers and metadata", () => {
  test("the token routes are exactly /invite/[token] and /reset/[token]", () => {
    expect(tokenRoutes.map(({ pattern }) => pattern).sort()).toEqual([
      "/invite/[token]",
      "/reset/[token]",
    ]);
  });

  describe.each(tokenRoutes)("$pattern", ({ file, pattern }) => {
    test.each(["GET", "POST"])(
      "a cookie-less %s carries Referrer-Policy: no-referrer and X-Robots-Tag",
      (method) => {
        const response = proxy(
          new NextRequest(new URL(routeUrl(pattern), "http://localhost:3000"), {
            method,
          }),
        );
        expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
        expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
        expect(response.headers.get("location")).toBeNull();
      },
    );

    test('the page metadata sets referrer: "no-referrer"', async () => {
      const specifier = `@/${file.replace(/^src\//, "").replace(/\.tsx$/, "")}`;
      const page: { metadata?: Metadata } = await import(
        /* @vite-ignore */ specifier
      );
      expect(page.metadata?.referrer).toBe("no-referrer");
    });
  });
});
