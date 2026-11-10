import { isRedirectError } from "next/dist/client/components/redirect-error";
import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
  TEST_PASSWORD,
} from "@/__tests__/support/test-db";
import { createInvitation, joinWithInvitation } from "@/actions/invitations";
import { createResetLink } from "@/actions/members";
import { resetPasswordWithGrant } from "@/actions/reset";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock("next/cache", () => ({ refresh: vi.fn() }));

vi.setConfig({ testTimeout: 90_000, hookTimeout: 60_000 });

const scope = createTestScope();
const NEW_PASSWORD = "a-brand-new-password";

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

function outcomeOf(settled: PromiseSettledResult<unknown>): unknown {
  if (settled.status === "fulfilled") return settled.value;
  if (isRedirectError(settled.reason)) {
    return { redirect: settled.reason.digest.split(";")[2] };
  }
  throw settled.reason;
}

const tokenOf = (url: string) => url.slice(url.lastIndexOf("/") + 1);

// Stage B ends when: two concurrent joins on one link make exactly one account;
// every bad token shows the same page with no database read on render; a used
// reset link has revoked every session; and the self and last-organizer
// guards hold for promote/demote/reset.
describe("Stage B exit condition", () => {
  test("(a) + (c): one link, two joins, one account; the reset revokes every session", async () => {
    // (a) An organizer makes a link through the action.
    const organizer = await scope.createTestUser({ role: "organizer" });
    const organizerCookie = await signInForCookie({
      ...organizer,
      ip: scope.ip(),
    });
    const asOrganizer = () =>
      mockNextRequest({
        ip: scope.ip(),
        cookies: { [SESSION_COOKIE]: organizerCookie },
      });
    asOrganizer();
    const created = await createInvitation({}, form({ note: "Exit test" }));
    expect(created.created?.url).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);
    const token = tokenOf(created.created!.url);

    // Two people join on it at once.
    const emails = [scope.email(), scope.email()];
    mockNextRequest({ ip: scope.ip() });
    const outcomes = (
      await Promise.allSettled(
        emails.map((email) =>
          joinWithInvitation(
            {},
            form({
              token,
              name: "Mira K.",
              email,
              password: TEST_PASSWORD,
              acceptHouseRules: "on",
            }),
          ),
        ),
      )
    ).map(outcomeOf);

    expect(outcomes).toEqual(
      expect.arrayContaining([{ redirect: "/" }, { linkBroken: true }]),
    );
    const accounts = await db.user.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true },
    });
    expect(accounts).toHaveLength(1);
    const [joined] = accounts;

    // (c) A reset link for the new member, who is signed in twice.
    asOrganizer();
    const reset = await createResetLink({}, form({ id: joined.id }));
    expect(reset.created?.url).toMatch(/\/reset\/[A-Za-z0-9_-]{43}$/);
    const resetToken = tokenOf(reset.created!.url);
    const cookies = [
      await signInForCookie({
        email: joined.email,
        password: TEST_PASSWORD,
        ip: scope.ip(),
      }),
      await signInForCookie({
        email: joined.email,
        password: TEST_PASSWORD,
        ip: scope.ip(),
      }),
    ];
    for (const cookie of cookies) {
      mockNextRequest({ cookies: { [SESSION_COOKIE]: cookie } });
      expect(await getViewer()).toMatchObject({ id: joined.id });
    }

    mockNextRequest({ ip: scope.ip() });
    expect(
      outcomeOf(
        (
          await Promise.allSettled([
            resetPasswordWithGrant(
              {},
              form({ token: resetToken, password: NEW_PASSWORD }),
            ),
          ])
        )[0],
      ),
    ).toEqual({ redirect: "/login" });

    // Every session is gone: neither cookie resolves to a viewer.
    expect(await scope.sessionsOf(joined.id)).toEqual([]);
    for (const cookie of cookies) {
      mockNextRequest({ cookies: { [SESSION_COOKIE]: cookie } });
      expect(await getViewer()).toBeNull();
    }

    // The new password works; the old one doesn't; the link is spent.
    await expect(
      signInForCookie({
        email: joined.email,
        password: NEW_PASSWORD,
        ip: scope.ip(),
      }),
    ).resolves.toEqual(expect.any(String));
    await expect(
      signInForCookie({
        email: joined.email,
        password: TEST_PASSWORD,
        ip: scope.ip(),
      }),
    ).rejects.toThrow(/401/);
    mockNextRequest({ ip: scope.ip() });
    expect(
      await resetPasswordWithGrant(
        {},
        form({ token: resetToken, password: "yet-another-password" }),
      ),
    ).toEqual({ linkBroken: true });
  });

  // (b) Every bad-token class on both forms gives the identical state, and the
  // token pages read nothing on render: stage-b/token-flows.test.ts and
  // stage-a/signed-out-no-session.test.ts.
  // (d) The self and last-organizer guards for promote, demote and reset link:
  // stage-b/organizer-guards.test.ts, plus the concurrent-demote test in
  // src/data/members.test.ts.
});
