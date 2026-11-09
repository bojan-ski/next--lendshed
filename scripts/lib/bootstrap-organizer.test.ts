import { isRedirectError } from "next/dist/client/components/redirect-error";
import { mockNextRequest } from "@/__tests__/support/next-request";
import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { signIn } from "@/actions/auth";
import { getViewer } from "@/data/viewer";
import {
  bootstrapOrganizer,
  type BootstrapResult,
} from "./bootstrap-organizer";
import { createScriptClient } from "./script-db";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();
const client = createScriptClient(process.env.DATABASE_URL_UNPOOLED!);
const PASSWORD = "organizer-password-1";

beforeAll(assertMigrated);
afterAll(async () => {
  await scope.cleanup();
  await client.$disconnect();
});

async function bootstrap(email: string): Promise<BootstrapResult> {
  const result = await bootstrapOrganizer(client, {
    name: "Ruth K.",
    email,
    password: PASSWORD,
  });
  scope.track(result.userId);
  return result;
}

function snapshot(email: string) {
  return client.user.findUniqueOrThrow({
    where: { email },
    select: {
      id: true,
      name: true,
      role: true,
      status: true,
      updatedAt: true,
      accounts: { select: { id: true, password: true, updatedAt: true } },
    },
  });
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("bootstrapOrganizer", () => {
  test("creates an active organizer with a credential account", async () => {
    const email = scope.email();
    const result = await bootstrap(`  ${email.toUpperCase()} `);

    expect(result).toEqual({
      outcome: "created",
      userId: expect.any(String),
      activeOrganizerCount: expect.any(Number),
    });
    const user = await snapshot(email);
    expect(user).toMatchObject({
      id: result.userId,
      name: "Ruth K.",
      role: "organizer",
      status: "active",
    });
    expect(user.accounts).toHaveLength(1);
  });

  test("a re-run returns already_organizer and writes nothing", async () => {
    const email = scope.email();
    const first = await bootstrap(email);
    const before = await snapshot(email);

    const again = await bootstrapOrganizer(client, {
      name: "Someone Else",
      email,
      password: "a-different-password",
    });

    expect(again).toEqual({
      outcome: "already_organizer",
      userId: first.userId,
      activeOrganizerCount: expect.any(Number),
    });
    expect(await snapshot(email)).toEqual(before);
    expect(await client.user.count({ where: { email } })).toBe(1);
  });

  test("activeOrganizerCount never counts the bootstrapped email itself", async () => {
    const email = scope.email();
    const totalOrganizers = () =>
      client.user.count({ where: { role: "organizer", status: "active" } });
    await bootstrap(email);
    const before = await totalOrganizers();
    const again = await bootstrap(email);
    const after = await totalOrganizers();
    if (again.outcome === "conflict") throw new Error("unexpected conflict");
    // Parallel files add and remove organizers; the email itself is in both totals.
    expect(again.activeOrganizerCount).toBeLessThan(Math.max(before, after));
  });

  test.each([
    ["an active member", { role: "member", status: "active" }, "member"],
    [
      "a suspended member",
      { role: "member", status: "suspended" },
      "suspended",
    ],
    [
      "a suspended organizer",
      { role: "organizer", status: "suspended" },
      "suspended",
    ],
  ] as const)(
    "%s's email is a conflict and nothing changes",
    async (_case, options, reason) => {
      const existing = await scope.createTestUser(options);
      const before = await snapshot(existing.email);

      const result = await bootstrapOrganizer(client, {
        name: "Ruth K.",
        email: existing.email.toUpperCase(),
        password: PASSWORD,
      });

      expect(result).toEqual({
        outcome: "conflict",
        userId: existing.id,
        reason,
      });
      expect(await snapshot(existing.email)).toEqual(before);
    },
  );

  test("two concurrent runs on one email end with one user", async () => {
    const email = scope.email();
    const results = await Promise.all([bootstrap(email), bootstrap(email)]);

    expect(results.map((result) => result.outcome).sort()).toEqual([
      "already_organizer",
      "created",
    ]);
    expect(results[0].userId).toBe(results[1].userId);
    expect(await client.user.count({ where: { email } })).toBe(1);
    expect(await client.account.count({ where: { user: { email } } })).toBe(1);
  });

  test("the bootstrapped organizer signs in and getViewer sees an organizer", async () => {
    const email = scope.email();
    const { userId } = await bootstrap(email);
    mockNextRequest({ ip: scope.ip() });

    const thrown = await signIn({}, form({ email, password: PASSWORD })).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(isRedirectError(thrown)).toBe(true);
    expect(await getViewer()).toMatchObject({ id: userId, role: "organizer" });
  });
});
