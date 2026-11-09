import {
  assertMigrated,
  createTestScope,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { db } from "@/db";
import { Prisma } from "@/generated/prisma/client";
import { createCredentialUser, setCredentialPassword } from "./credentials";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();
const PASSWORD = "first-password-123";

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

async function create(
  input: Partial<Parameters<typeof createCredentialUser>[1]> = {},
) {
  const email = scope.email();
  const { id } = await createCredentialUser(db, {
    name: "Ana P.",
    email,
    password: PASSWORD,
    ...input,
  });
  scope.track(id);
  return { id, email: input.email?.trim().toLowerCase() ?? email };
}

function signInWith(email: string, password: string) {
  return signInForCookie({ email, password, ip: scope.ip() });
}

describe("createCredentialUser", () => {
  test("writes the User and credential Account rows of the contract", async () => {
    const email = scope.email();
    const { id } = await createCredentialUser(db, {
      name: "Ruth K.",
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      role: "organizer",
      status: "suspended",
      area: "Elm Street",
      contactDetails: "Phone 555 0101\nSide gate",
    });
    scope.track(id);

    const user = await db.user.findUniqueOrThrow({
      where: { id },
      include: { accounts: true },
    });
    expect(user).toMatchObject({
      name: "Ruth K.",
      email,
      emailVerified: false,
      image: null,
      role: "organizer",
      status: "suspended",
      area: "Elm Street",
      contactDetails: "Phone 555 0101\nSide gate",
    });
    expect(user.createdAt).toBeInstanceOf(Date);
    expect(user.accounts).toHaveLength(1);
    const [account] = user.accounts;
    expect(account).toMatchObject({
      userId: id,
      accountId: id,
      providerId: "credential",
      accessToken: null,
      refreshToken: null,
      idToken: null,
      accessTokenExpiresAt: null,
      refreshTokenExpiresAt: null,
      scope: null,
    });
    expect(account.id).not.toBe(id);
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(PASSWORD);
  });

  test("defaults to an active member with no area or contact details", async () => {
    const { id } = await create();
    expect(
      await db.user.findUniqueOrThrow({
        where: { id },
        select: { role: true, status: true, area: true, contactDetails: true },
      }),
    ).toEqual({
      role: "member",
      status: "active",
      area: null,
      contactDetails: null,
    });
  });

  test("hashes with the library's hasher: the user signs in through auth.handler", async () => {
    const { email } = await create();
    await expect(signInWith(email, PASSWORD)).resolves.toBeTruthy();
  });

  test("a duplicate email fails with P2002 and adds no Account row", async () => {
    const { id, email } = await create();
    await expect(
      createCredentialUser(db, { name: "Copy C.", email, password: PASSWORD }),
    ).rejects.toMatchObject({ code: "P2002" });
    expect(await db.account.count({ where: { userId: id } })).toBe(1);
    expect(await db.user.count({ where: { email } })).toBe(1);
  });

  test("inside a caller's transaction a duplicate rolls back every row it wrote", async () => {
    const { email: taken } = await create();
    const fresh = scope.email();

    const attempt = db.$transaction(async (tx) => {
      await createCredentialUser(tx, {
        name: "Lena S.",
        email: fresh,
        password: PASSWORD,
      });
      await createCredentialUser(tx, {
        name: "Copy C.",
        email: taken,
        password: PASSWORD,
      });
    });

    await expect(attempt).rejects.toBeInstanceOf(
      Prisma.PrismaClientKnownRequestError,
    );
    expect(await db.user.count({ where: { email: fresh } })).toBe(0);
    expect(await db.account.count({ where: { user: { email: fresh } } })).toBe(
      0,
    );
  });

  test("joins the caller's transaction: a later failure leaves neither row", async () => {
    const email = scope.email();
    let createdId = "";
    await expect(
      db.$transaction(async (tx) => {
        createdId = (
          await createCredentialUser(tx, {
            name: "Tom B.",
            email,
            password: PASSWORD,
          })
        ).id;
        throw new Error("caller aborts");
      }),
    ).rejects.toThrow("caller aborts");
    expect(createdId).not.toBe("");
    expect(await db.user.count({ where: { id: createdId } })).toBe(0);
    expect(await db.account.count({ where: { userId: createdId } })).toBe(0);
  });
});

describe("setCredentialPassword", () => {
  test("replaces the hash: the new password signs in and the old one doesn't", async () => {
    const { id, email } = await create();
    const before = await db.account.findFirstOrThrow({ where: { userId: id } });

    await setCredentialPassword(db, id, "second-password-456");

    const after = await db.account.findMany({ where: { userId: id } });
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before.id);
    expect(after[0].password).not.toBe(before.password);
    await expect(
      signInWith(email, "second-password-456"),
    ).resolves.toBeTruthy();
    await expect(signInWith(email, PASSWORD)).rejects.toThrow(/answered 401/);
  });

  test("creates the credential account when the user has none", async () => {
    const { id, email } = await create();
    await db.account.deleteMany({ where: { userId: id } });

    await setCredentialPassword(db, id, "second-password-456");

    expect(await db.account.findMany({ where: { userId: id } })).toEqual([
      expect.objectContaining({
        userId: id,
        accountId: id,
        providerId: "credential",
      }),
    ]);
    await expect(
      signInWith(email, "second-password-456"),
    ).resolves.toBeTruthy();
  });
});
