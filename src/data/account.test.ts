import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import {
  getAccount,
  updateOwnContactDetails,
  updateOwnProfile,
} from "./account";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

const columns = (id: string) =>
  db.user.findUniqueOrThrow({
    where: { id },
    select: { name: true, area: true, contactDetails: true },
  });

describe("getAccount", () => {
  test("returns exactly the five AccountDTO fields", async () => {
    const user = await scope.createTestUser({ name: "Mira K." });
    await db.user.update({
      where: { id: user.id },
      data: { area: "north end", contactDetails: "Phone 555 0101\nAfter 6" },
    });

    expect(await getAccount(user.id)).toEqual({
      displayName: "Mira K.",
      area: "north end",
      contactDetails: "Phone 555 0101\nAfter 6",
      email: user.email,
      contactDetailsLocked: false,
    });
  });

  test("an empty account carries nulls, never ids, roles, timestamps or auth fields", async () => {
    const user = await scope.createTestUser({ role: "organizer" });
    const dto = await getAccount(user.id);

    expect(Object.keys(dto).sort()).toEqual([
      "area",
      "contactDetails",
      "contactDetailsLocked",
      "displayName",
      "email",
    ]);
    expect(dto.area).toBeNull();
    expect(dto.contactDetails).toBeNull();
    expect(JSON.stringify(dto)).not.toContain(user.id);
  });

  test("a missing user throws (the page's error surface)", async () => {
    await expect(getAccount("no-such-user")).rejects.toThrow();
  });
});

describe("updateOwnProfile", () => {
  test("writes name and area on the given user only", async () => {
    const user = await scope.createTestUser({ name: "Mira K." });
    const other = await scope.createTestUser({ name: "Tom B." });

    await updateOwnProfile(user.id, { name: "Mira Kay", area: "north end" });

    expect(await columns(user.id)).toMatchObject({
      name: "Mira Kay",
      area: "north end",
    });
    expect(await columns(other.id)).toEqual({
      name: "Tom B.",
      area: null,
      contactDetails: null,
    });
  });

  test("a null area clears it", async () => {
    const user = await scope.createTestUser();
    await updateOwnProfile(user.id, { name: "Mira K.", area: "north end" });
    await updateOwnProfile(user.id, { name: "Mira K.", area: null });
    expect((await columns(user.id)).area).toBeNull();
  });
});

describe("updateOwnContactDetails", () => {
  test("saves multi-line details on the given user only", async () => {
    const user = await scope.createTestUser();
    const other = await scope.createTestUser();

    expect(await updateOwnContactDetails(user.id, "Phone 555\nAfter 6")).toBe(
      "saved",
    );

    expect((await columns(user.id)).contactDetails).toBe("Phone 555\nAfter 6");
    expect((await columns(other.id)).contactDetails).toBeNull();
  });

  // Until spec 09 nothing locks the details, so a clear always goes through.
  test("null clears the details while nothing locks them", async () => {
    const user = await scope.createTestUser();
    await updateOwnContactDetails(user.id, "Phone 555");

    expect(await updateOwnContactDetails(user.id, null)).toBe("saved");

    expect((await columns(user.id)).contactDetails).toBeNull();
    expect((await getAccount(user.id)).contactDetailsLocked).toBe(false);
  });
});
