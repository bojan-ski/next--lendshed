import { isRedirectError } from "next/dist/client/components/redirect-error";
import { refresh } from "next/cache";
import {
  mockNextRequest,
  readCookie,
  readCookieOptions,
} from "@/__tests__/support/next-request";
import {
  assertMigrated,
  createTestScope,
  SESSION_COOKIE,
  signInForCookie,
} from "@/__tests__/support/test-db";
import { updateOwnContactDetails, updateOwnProfile } from "@/data/account";
import { getViewer } from "@/data/viewer";
import { db } from "@/db";
import { auth } from "@/lib/auth/auth";
import { env } from "@/lib/env/server";
import { account } from "@/strings/account";
import type {
  ChangePasswordState,
  ContactDetailsFormState,
  ProfileFormState,
} from "@/types/account";
import { changePassword, updateContactDetails, updateProfile } from "./account";

vi.mock(
  "next/headers",
  async () =>
    (await import("@/__tests__/support/next-request")).nextHeadersModule,
);
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
// Spied, not replaced: real queries unless a test overrides one call.
vi.mock("@/data/account", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/account")>();
  return {
    ...actual,
    updateOwnProfile: vi.fn(actual.updateOwnProfile),
    updateOwnContactDetails: vi.fn(actual.updateOwnContactDetails),
  };
});

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const scope = createTestScope();
const idleProfile: ProfileFormState = {};
const idleContact: ContactDetailsFormState = {};
const idlePassword: ChangePasswordState = {};
const NEW_PASSWORD = "a-brand-new-password";

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());
afterEach(() => vi.restoreAllMocks());

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function redirectTarget(promise: Promise<unknown>): Promise<string> {
  const error = await promise.then(
    () => {
      throw new Error("expected a redirect");
    },
    (thrown: unknown) => thrown,
  );
  if (!isRedirectError(error)) throw error;
  return error.digest.split(";")[2];
}

// Signs a fresh user in and makes them the request's viewer.
async function actAs(options: { name?: string } = {}) {
  const user = await scope.createTestUser(options);
  const ip = scope.ip();
  const cookie = await signInForCookie({ ...user, ip });
  mockNextRequest({ ip, cookies: { [SESSION_COOKIE]: cookie } });
  return { ...user, ip, cookie };
}

// A member whose session is still in the database but who is suspended.
async function actAsSuspended() {
  const viewer = await actAs();
  await db.user.update({
    where: { id: viewer.id },
    data: { status: "suspended" },
  });
  return viewer;
}

const columns = (id: string) =>
  db.user.findUniqueOrThrow({
    where: { id },
    select: { name: true, area: true, contactDetails: true },
  });

const passwordHash = async (userId: string) =>
  (
    await db.account.findFirstOrThrow({
      where: { userId, providerId: "credential" },
      select: { password: true },
    })
  ).password;

describe("updateProfile", () => {
  test("writes the trimmed name and area for the viewer only, then refreshes", async () => {
    const viewer = await actAs({ name: "Mira K." });
    const other = await scope.createTestUser({ name: "Tom B." });

    const state = await updateProfile(
      idleProfile,
      form({ name: "  Mira Kay  ", area: "  north end " }),
    );

    expect(state).toEqual({ flash: "profileSaved" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await columns(viewer.id)).toMatchObject({
      name: "Mira Kay",
      area: "north end",
    });
    expect((await columns(other.id)).name).toBe("Tom B.");
  });

  test("an empty area is stored as null", async () => {
    const viewer = await actAs();
    await db.user.update({ where: { id: viewer.id }, data: { area: "old" } });

    await updateProfile(idleProfile, form({ name: "Mira K.", area: "   " }));

    expect((await columns(viewer.id)).area).toBeNull();
  });

  test.each([
    [{ name: "M", area: "" }, "name", account.nameTooShort],
    [{ name: "M".repeat(41), area: "" }, "name", account.nameTooLong],
    [{ name: "Mira K.", area: "a".repeat(41) }, "area", account.areaTooLong],
  ])(
    "%j returns a field error under %s, echoes the values and writes nothing",
    async (fields, key, message) => {
      const viewer = await actAs({ name: "Mira K." });
      const before = await columns(viewer.id);

      const state = await updateProfile(idleProfile, form(fields));

      expect(state.fieldErrors?.[key as "name" | "area"]).toEqual([message]);
      expect(state).toMatchObject(fields);
      expect(state.flash).toBeUndefined();
      expect(refresh).not.toHaveBeenCalled();
      expect(await columns(viewer.id)).toEqual(before);
    },
  );

  test("an unexpected failure returns the notice with the values echoed", async () => {
    await actAs();
    vi.mocked(updateOwnProfile).mockRejectedValueOnce(new Error("boom"));

    const state = await updateProfile(
      idleProfile,
      form({ name: "Mira Kay", area: "north end" }),
    );

    expect(state).toEqual({
      formError: "unexpected",
      name: "Mira Kay",
      area: "north end",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a suspended member is sent to /login and nothing is written", async () => {
    const viewer = await actAsSuspended();
    const before = await columns(viewer.id);

    expect(
      await redirectTarget(
        updateProfile(idleProfile, form({ name: "Someone Else" })),
      ),
    ).toBe("/login");
    expect(await columns(viewer.id)).toEqual(before);
  });
});

describe("updateContactDetails", () => {
  test("saves multi-line details with CRLF normalised, then refreshes", async () => {
    const viewer = await actAs();

    const state = await updateContactDetails(
      idleContact,
      form({ contactDetails: "Phone 555 0101\r\nAfter 6\r\n" }),
    );

    expect(state).toEqual({ flash: "contactDetailsSaved" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await columns(viewer.id)).contactDetails).toBe(
      "Phone 555 0101\nAfter 6",
    );
  });

  test("whitespace-only input clears the details", async () => {
    const viewer = await actAs();
    await db.user.update({
      where: { id: viewer.id },
      data: { contactDetails: "Phone 555" },
    });

    const state = await updateContactDetails(
      idleContact,
      form({ contactDetails: " \r\n " }),
    );

    expect(state).toEqual({ flash: "contactDetailsSaved" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect((await columns(viewer.id)).contactDetails).toBeNull();
  });

  test("301 normalised characters return a field error with the text echoed", async () => {
    const viewer = await actAs();
    const text = `${"a".repeat(150)}\r\n${"a".repeat(150)}`;

    const state = await updateContactDetails(
      idleContact,
      form({ contactDetails: text }),
    );

    expect(state).toEqual({
      fieldErrors: { contactDetails: [account.contactTooLong] },
      contactDetails: text,
    });
    expect(refresh).not.toHaveBeenCalled();
    expect((await columns(viewer.id)).contactDetails).toBeNull();
  });

  // 23:30Z on 11 Nov is already the 12th in Belgrade: the community date, not UTC's.
  test("passes one community today to the data call", async () => {
    const viewer = await actAs();
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-11-11T23:30:00Z"),
    });
    try {
      await updateContactDetails(
        idleContact,
        form({ contactDetails: "Phone 555" }),
      );
    } finally {
      vi.useRealTimers();
    }

    expect(updateOwnContactDetails).toHaveBeenCalledTimes(1);
    expect(updateOwnContactDetails).toHaveBeenCalledWith(
      viewer.id,
      "Phone 555",
      "2026-11-12",
    );
  });

  test("a clear refused by a real listed item writes nothing", async () => {
    const viewer = await actAs();
    await db.user.update({
      where: { id: viewer.id },
      data: { contactDetails: "Phone 555" },
    });
    await scope.createItem({ ownerId: viewer.id, status: "listed" });

    const state = await updateContactDetails(
      idleContact,
      form({ contactDetails: "" }),
    );

    expect(state).toEqual({ formError: "contactDetailsLocked" });
    expect(refresh).not.toHaveBeenCalled();
    expect((await columns(viewer.id)).contactDetails).toBe("Phone 555");
  });

  test("a locked clear echoes nothing and skips refresh()", async () => {
    await actAs();
    vi.mocked(updateOwnContactDetails).mockResolvedValueOnce("locked");

    const state = await updateContactDetails(
      idleContact,
      form({ contactDetails: "" }),
    );

    expect(state).toEqual({ formError: "contactDetailsLocked" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("an unexpected failure returns the notice with the text echoed", async () => {
    await actAs();
    vi.mocked(updateOwnContactDetails).mockRejectedValueOnce(new Error("boom"));

    const state = await updateContactDetails(
      idleContact,
      form({ contactDetails: "Phone 555" }),
    );

    expect(state).toEqual({
      formError: "unexpected",
      contactDetails: "Phone 555",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a suspended member is sent to /login and nothing is written", async () => {
    const viewer = await actAsSuspended();

    expect(
      await redirectTarget(
        updateContactDetails(idleContact, form({ contactDetails: "Phone" })),
      ),
    ).toBe("/login");
    expect((await columns(viewer.id)).contactDetails).toBeNull();
  });
});

describe("changePassword", () => {
  test("a 9-character new password is refused without reaching the library", async () => {
    const viewer = await actAs();
    const handler = vi.spyOn(auth, "handler");

    const state = await changePassword(
      idlePassword,
      form({ currentPassword: viewer.password, newPassword: "a".repeat(9) }),
    );

    expect(state).toEqual({
      fieldErrors: {
        currentPassword: undefined,
        newPassword: [account.passwordTooShort],
      },
    });
    expect(handler).not.toHaveBeenCalled();
  });

  test("a wrong current password is a field error; the hash and sessions are unchanged", async () => {
    const viewer = await actAs();
    const hashBefore = await passwordHash(viewer.id);
    const sessionsBefore = await scope.sessionsOf(viewer.id);

    const state = await changePassword(
      idlePassword,
      form({ currentPassword: "not-the-password", newPassword: NEW_PASSWORD }),
    );

    expect(state).toEqual({
      fieldErrors: { currentPassword: [account.currentPasswordWrong] },
    });
    expect(await passwordHash(viewer.id)).toBe(hashBefore);
    expect(await scope.sessionsOf(viewer.id)).toEqual(sessionsBefore);
    expect(refresh).not.toHaveBeenCalled();
  });

  test("success deletes every session, issues the caller one new session and swaps the password", async () => {
    const viewer = await actAs();
    // A second device, signed in separately.
    await signInForCookie({ ...viewer, ip: scope.ip() });
    const before = await scope.sessionsOf(viewer.id);
    expect(before).toHaveLength(2);

    const state = await changePassword(
      idlePassword,
      form({ currentPassword: viewer.password, newPassword: NEW_PASSWORD }),
    );

    expect(state).toEqual({ flash: "passwordChanged" });
    expect(refresh).not.toHaveBeenCalled();

    const after = await scope.sessionsOf(viewer.id);
    expect(after).toHaveLength(1);
    const oldIds = before.map(({ id }) => id);
    expect(oldIds).not.toContain(after[0].id);

    // The new cookie carries the library's attributes and resolves.
    const rotated = readCookie(SESSION_COOKIE);
    expect(rotated).toBeTruthy();
    expect(rotated).not.toBe(viewer.cookie);
    expect(readCookieOptions(SESSION_COOKIE)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 24 * 60 * 60,
      secure: new URL(env.APP_URL).protocol === "https:" || undefined,
    });
    expect(await getViewer()).toMatchObject({ id: viewer.id });

    // The old cookie is dead; only the new password signs in.
    mockNextRequest({
      ip: viewer.ip,
      cookies: { [SESSION_COOKIE]: viewer.cookie },
    });
    expect(await getViewer()).toBeNull();
    await expect(
      signInForCookie({ ...viewer, ip: scope.ip() }),
    ).rejects.toThrow();
    await expect(
      signInForCookie({ ...viewer, password: NEW_PASSWORD, ip: scope.ip() }),
    ).resolves.toBeTruthy();
  });

  test("a fourth rapid attempt from one address is refused as too many", async () => {
    const viewer = await actAs();
    const attempt = () =>
      changePassword(
        idlePassword,
        form({
          currentPassword: "not-the-password",
          newPassword: NEW_PASSWORD,
        }),
      );

    const states: ChangePasswordState[] = [];
    for (let i = 0; i < 4; i++) states.push(await attempt());

    expect(states.slice(0, 3)).toEqual(
      Array(3).fill({
        fieldErrors: { currentPassword: [account.currentPasswordWrong] },
      }),
    );
    expect(states[3]).toEqual({ formError: "tooManyAttempts" });
    expect(await scope.sessionsOf(viewer.id)).toHaveLength(1);
  });

  test.each([
    ["a library throw", () => Promise.reject(new Error("boom"))],
    [
      "a 401 (the session vanished mid-request)",
      () => Promise.resolve(new Response("{}", { status: 401 })),
    ],
    [
      "a 400 with another code",
      () =>
        Promise.resolve(
          Response.json({ code: "PASSWORD_TOO_SHORT" }, { status: 400 }),
        ),
    ],
  ])("%s is unexpected", async (_label, reply) => {
    await actAs();
    vi.spyOn(auth, "handler").mockImplementation(reply);

    const state = await changePassword(
      idlePassword,
      form({ currentPassword: "whatever", newPassword: NEW_PASSWORD }),
    );

    expect(state).toEqual({ formError: "unexpected" });
  });

  test("no state ever carries a password", async () => {
    const viewer = await actAs();
    const passwords = [viewer.password, NEW_PASSWORD, "short"];
    const states = [
      await changePassword(
        idlePassword,
        form({ currentPassword: viewer.password, newPassword: "short" }),
      ),
      await changePassword(
        idlePassword,
        form({ currentPassword: "wrong-one", newPassword: NEW_PASSWORD }),
      ),
    ];
    for (const state of states) {
      for (const password of passwords) {
        expect(JSON.stringify(state)).not.toContain(password);
      }
    }
  });

  test("a suspended member is sent to /login before the library is reached", async () => {
    const viewer = await actAsSuspended();
    const handler = vi.spyOn(auth, "handler");
    const hashBefore = await passwordHash(viewer.id);

    expect(
      await redirectTarget(
        changePassword(
          idlePassword,
          form({ currentPassword: viewer.password, newPassword: NEW_PASSWORD }),
        ),
      ),
    ).toBe("/login");
    expect(handler).not.toHaveBeenCalled();
    expect(await passwordHash(viewer.id)).toBe(hashBefore);
  });
});
