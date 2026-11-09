import { isRedirectError } from "next/dist/client/components/redirect-error";
import { mockNextRequest } from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { signIn } from "@/actions/auth";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { setCredentialPassword } from "@/db/credentials";
import {
  DEMO_PASSWORD,
  SEED_EMAIL_DOMAIN,
  SEED_PEOPLE,
  seedPeople,
  type SeedPerson,
} from "./people";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

// A fresh copy of the cast per call: same values, tagged emails. Tests never alter the real cast.
let copies = 0;
function castCopy(): SeedPerson[] {
  const prefix = `${scope.tag}c${++copies}`;
  return SEED_PEOPLE.map((person) => ({
    ...person,
    email: `${prefix}-${person.email}`,
  }));
}

async function seedCopy(cast: readonly SeedPerson[]) {
  await seedPeople(db, cast);
  const users = await db.user.findMany({
    where: { email: { in: cast.map((person) => person.email) } },
    select: { id: true, email: true },
  });
  for (const user of users) scope.track(user.id);
  return users;
}

function seededValues(email: string) {
  return db.user.findUniqueOrThrow({
    where: { email },
    select: {
      name: true,
      role: true,
      status: true,
      area: true,
      contactDetails: true,
    },
  });
}

describe("SEED_PEOPLE", () => {
  const active = SEED_PEOPLE.filter((person) => person.status === "active");

  test("has two active organizers and one suspended member", () => {
    expect(active.filter((person) => person.role === "organizer")).toHaveLength(
      2,
    );
    expect(
      SEED_PEOPLE.filter((person) => person.status === "suspended"),
    ).toEqual([expect.objectContaining({ role: "member" })]);
    expect(
      active.filter((person) => person.role === "member").length,
    ).toBeGreaterThanOrEqual(5);
  });

  test("has an active member without contact details and multi-line contact details", () => {
    expect(
      active.some(
        (person) => person.role === "member" && person.contactDetails === null,
      ),
    ).toBe(true);
    expect(
      SEED_PEOPLE.some((person) => person.contactDetails?.includes("\n")),
    ).toBe(true);
  });

  test.each(SEED_PEOPLE.map((person) => [person.email, person]))(
    "%s is within the OQ-29 limits",
    (_email, person) => {
      expect(person.email).toMatch(
        new RegExp(`^[a-z]+@${SEED_EMAIL_DOMAIN.replace(".", "\\.")}$`),
      );
      expect(person.name).toMatch(/^\S+ [A-Z]\.$/);
      expect(person.name.length).toBeGreaterThanOrEqual(2);
      expect(person.name.length).toBeLessThanOrEqual(40);
      expect(person.area.length).toBeGreaterThan(0);
      expect(person.area.length).toBeLessThanOrEqual(40);
      if (person.contactDetails !== null) {
        expect(person.contactDetails.length).toBeGreaterThanOrEqual(1);
        expect(person.contactDetails.length).toBeLessThanOrEqual(300);
      }
    },
  );

  test("emails are unique, the domain is reserved .test and the password is 10–128", () => {
    expect(new Set(SEED_PEOPLE.map((person) => person.email)).size).toBe(
      SEED_PEOPLE.length,
    );
    expect(SEED_EMAIL_DOMAIN.endsWith(".test")).toBe(true);
    expect(SEED_EMAIL_DOMAIN).not.toBe("test.invalid");
    expect(DEMO_PASSWORD.length).toBeGreaterThanOrEqual(10);
    expect(DEMO_PASSWORD.length).toBeLessThanOrEqual(128);
  });
});

describe("seedPeople on a run-unique cast", () => {
  test("running twice leaves exactly one user per person, with stable ids", async () => {
    const cast = castCopy();
    const first = await seedCopy(cast);
    const second = await seedCopy(cast);

    expect(first).toHaveLength(cast.length);
    expect(second.map((user) => user.id).sort()).toEqual(
      first.map((user) => user.id).sort(),
    );
    for (const person of cast) {
      expect(await db.user.count({ where: { email: person.email } })).toBe(1);
      expect(
        await db.account.count({ where: { user: { email: person.email } } }),
      ).toBe(1);
    }
  });

  test("restores changed fields and the password on the next run", async () => {
    const cast = castCopy();
    const users = await seedCopy(cast);
    const target = cast.find((person) => person.role === "organizer")!;
    const { id } = users.find((user) => user.email === target.email)!;

    await db.user.update({
      where: { id },
      data: {
        name: "Changed X.",
        role: "member",
        status: "suspended",
        area: "Elsewhere",
        contactDetails: null,
      },
    });
    await setCredentialPassword(db, id, "changed-password-1");

    await seedPeople(db, cast);

    expect(await seededValues(target.email)).toEqual({
      name: target.name,
      role: target.role,
      status: target.status,
      area: target.area,
      contactDetails: target.contactDetails,
    });
    await expect(
      signInForCookie({
        email: target.email,
        password: DEMO_PASSWORD,
        ip: scope.ip(),
      }),
    ).resolves.toBeTruthy();
    await expect(
      signInForCookie({
        email: target.email,
        password: "changed-password-1",
        ip: scope.ip(),
      }),
    ).rejects.toThrow(/answered 401/);
  });

  test("leaves other users alone and creates no sessions", async () => {
    const outsider = await scope.createTestUser();
    const before = await db.user.findUniqueOrThrow({
      where: { id: outsider.id },
      include: { accounts: true },
    });

    const cast = castCopy();
    const users = await seedCopy(cast);

    expect(
      await db.user.findUniqueOrThrow({
        where: { id: outsider.id },
        include: { accounts: true },
      }),
    ).toEqual(before);
    expect(
      await db.session.count({
        where: { userId: { in: users.map((user) => user.id) } },
      }),
    ).toBe(0);
  });

  test("refuses a cast with an email outside the seed domain before writing anything", async () => {
    const outsider = await scope.createTestUser();
    const before = await db.user.findUniqueOrThrow({
      where: { id: outsider.id },
      include: { accounts: true },
    });
    const [first, second, third] = castCopy();

    const attempt = seedPeople(db, [
      first,
      second,
      { ...third, email: outsider.email },
    ]).then(
      () => undefined,
      (error: unknown) => error,
    );
    const outcome = await attempt;
    const leaked = await db.user.findMany({
      where: { email: { in: [first.email, second.email] } },
      select: { id: true },
    });
    for (const user of leaked) scope.track(user.id);

    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain(SEED_EMAIL_DOMAIN);
    expect(leaked).toEqual([]);
    expect(
      await db.user.findUniqueOrThrow({
        where: { id: outsider.id },
        include: { accounts: true },
      }),
    ).toEqual(before);
  });
});

describe("the real cast", () => {
  const organizer = SEED_PEOPLE.find(
    (person) => person.role === "organizer" && person.status === "active",
  )!;
  const suspended = SEED_PEOPLE.find(
    (person) => person.status === "suspended",
  )!;
  const createdSessions: string[] = [];

  beforeAll(() => seedPeople(db));
  afterAll(async () => {
    if (createdSessions.length > 0) {
      await db.session.deleteMany({ where: { id: { in: createdSessions } } });
    }
  });

  async function sessionIds(email: string): Promise<string[]> {
    const sessions = await db.session.findMany({
      where: { user: { email } },
      select: { id: true },
    });
    return sessions.map((session) => session.id);
  }

  test("the suspended member is told so only with the right password, and gets no session", async () => {
    const before = await sessionIds(suspended.email);

    mockNextRequest({ ip: scope.ip() });
    const right = await signIn(
      {},
      form({ email: suspended.email, password: DEMO_PASSWORD }),
    );
    mockNextRequest({ ip: scope.ip() });
    const wrong = await signIn(
      {},
      form({ email: suspended.email, password: "not-the-password" }),
    );

    expect(right).toEqual({ formError: "suspended", email: suspended.email });
    expect(wrong).toEqual({
      formError: "invalidCredentials",
      email: suspended.email,
    });
    expect(await sessionIds(suspended.email)).toEqual(before);
  });

  test("a seed organizer signs in and getViewer sees an organizer", async () => {
    const before = new Set(await sessionIds(organizer.email));
    mockNextRequest({ ip: scope.ip() });

    const thrown = await signIn(
      {},
      form({ email: organizer.email, password: DEMO_PASSWORD }),
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    const created = (await sessionIds(organizer.email)).filter(
      (id) => !before.has(id),
    );
    createdSessions.push(...created);

    expect(isRedirectError(thrown)).toBe(true);
    expect(created).toHaveLength(1);
    expect(await getViewer()).toMatchObject({
      displayName: organizer.name,
      role: "organizer",
    });
  });
});
