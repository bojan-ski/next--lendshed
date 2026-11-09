import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { db } from "@/db";
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
      needsActionCount: 0,
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

  test("returns null for a suspended member with a live session", async () => {
    const user = await signedIn();
    await db.user.update({
      where: { id: user.id },
      data: { status: "suspended" },
    });
    expect(await getViewer()).toBeNull();
  });
});
