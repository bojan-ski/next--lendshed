import { cookies } from "next/headers";
import {
  freezeHeaderCookies,
  mockNextRequest,
} from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import {
  importSpecifiers,
  parseFile,
  readSource,
} from "@/__tests__/support/import-graph";
import { db } from "@/db";
import { requireOrganizer } from "@/lib/auth/guards";
import { getViewer } from "./viewer";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

async function signedIn(
  options: Parameters<typeof scope.createTestUser>[0] = {},
) {
  const user = await scope.createTestUser(options);
  const ip = scope.ip();
  const token = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: token } });
  return user;
}

describe("getViewer", () => {
  test("returns null with no cookie", async () => {
    mockNextRequest({ ip: scope.ip() });
    expect(await getViewer()).toBeNull();
  });

  test("returns null for an unknown token", async () => {
    mockNextRequest({
      ip: scope.ip(),
      cookies: { [SESSION_COOKIE]: "unknown-token.bad-signature" },
    });
    expect(await getViewer()).toBeNull();
  });

  test("returns exactly the ViewerDTO fields: no email, status or session data", async () => {
    const user = await signedIn({ name: "Mira K." });
    expect(await getViewer()).toEqual({
      id: user.id,
      displayName: "Mira K.",
      initials: "MK",
      role: "member",
    });
  });

  test("carries the organizer role", async () => {
    await signedIn({ role: "organizer", name: "Ruth" });
    expect(await getViewer()).toMatchObject({
      role: "organizer",
      initials: "R",
    });
  });

  test("returns null once the session has expired", async () => {
    const user = await signedIn();
    await db.session.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    expect(await getViewer()).toBeNull();
  });

  // A password change deletes the session and sets a new cookie; Next then
  // re-renders with the new cookie in cookies() and the old one in headers().
  test("reads a session rotated by an action from cookies(), not the stale Cookie header", async () => {
    const user = await signedIn({ name: "Mira K." });
    freezeHeaderCookies();
    await db.session.deleteMany({ where: { userId: user.id } });
    const rotated = await signInForCookie({ ...user, ip: scope.ip() });
    (await cookies()).set(SESSION_COOKIE, rotated);

    expect(await getViewer()).toMatchObject({ id: user.id });
  });

  test("a cookie an action deleted reads as signed out, whatever the stale header says", async () => {
    await signedIn();
    freezeHeaderCookies();
    (await cookies()).delete(SESSION_COOKIE);

    expect(await getViewer()).toBeNull();
  });

  // No cookie cache (OQ-10): the role is read from the database on every
  // request, so a demotion bites on the organizer's very next request.
  test("an organizer demoted mid-session is a member on the next read", async () => {
    const user = await signedIn({ role: "organizer" });
    expect(await getViewer()).toMatchObject({ role: "organizer" });

    await db.user.update({ where: { id: user.id }, data: { role: "member" } });

    expect(await getViewer()).toMatchObject({ id: user.id, role: "member" });
    const error = await requireOrganizer().then(
      () => null,
      (thrown: unknown) => thrown,
    );
    expect((error as { digest?: string } | null)?.digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });

  test("returns null for a suspended member with a live session", async () => {
    const user = await signedIn();
    await db.user.update({
      where: { id: user.id },
      data: { status: "suspended" },
    });
    expect(await getViewer()).toBeNull();
  });
});

// Spec 16: the needs-action count lives in the header's badge slot, so the
// session read that every action and section runs stays one query.
describe("getViewer and the needs-action count", () => {
  test("the viewer module reads no loan and imports no loan module", () => {
    const imports = importSpecifiers(parseFile("src/data/viewer.ts"));
    expect(imports.filter((name) => /loan/i.test(name))).toEqual([]);
    expect(readSource("src/data/viewer.ts")).not.toMatch(/\.loan\b|needsAction/);
  });
});
