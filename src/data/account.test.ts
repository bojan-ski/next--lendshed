import { assertMigrated, createTestScope } from "@/__tests__/support/test-db";
import { db } from "@/db";
import type { ItemStatus, LoanStatus } from "@/generated/prisma/enums";
import { addDays, communityToday } from "@/lib/dates/dates";
import {
  getAccount,
  updateOwnContactDetails,
  updateOwnProfile,
} from "./account";

vi.setConfig({ testTimeout: 30_000, hookTimeout: 60_000 });

const scope = createTestScope();
const today = communityToday();

beforeAll(assertMigrated);
afterAll(() => scope.cleanup());

const columns = (id: string) =>
  db.user.findUniqueOrThrow({
    where: { id },
    select: { name: true, area: true, contactDetails: true },
  });

describe("getAccount", () => {
  test("returns exactly the six AccountDTO fields", async () => {
    const user = await scope.createTestUser({ name: "Mira K." });
    await db.user.update({
      where: { id: user.id },
      data: { area: "north end", contactDetails: "Phone 555 0101\nAfter 6" },
    });

    expect(await getAccount(user.id, today)).toEqual({
      displayName: "Mira K.",
      area: "north end",
      contactDetails: "Phone 555 0101\nAfter 6",
      email: user.email,
      contactDetailsLocked: false,
      deletion: { allowed: true, reason: null },
    });
  });

  test("an empty account carries nulls, never ids, roles, timestamps or auth fields", async () => {
    const user = await scope.createTestUser({ role: "organizer" });
    const dto = await getAccount(user.id, today);

    expect(Object.keys(dto).sort()).toEqual([
      "area",
      "contactDetails",
      "contactDetailsLocked",
      "deletion",
      "displayName",
      "email",
    ]);
    expect(dto.deletion).toEqual({ allowed: true, reason: null });
    expect(JSON.stringify(dto)).not.toContain("organizer");
    expect(dto.area).toBeNull();
    expect(dto.contactDetails).toBeNull();
    expect(JSON.stringify(dto)).not.toContain(user.id);
  });

  test("a missing user throws (the page's error surface)", async () => {
    await expect(getAccount("no-such-user", today)).rejects.toThrow();
  });
});

describe("getAccount deletion hint (the deletion's refusal order)", () => {
  type Side = "owned" | "borrowed";
  type Kind = "approved" | "out" | "overdue";
  const DATES: Record<Kind, [LoanStatus, string, string]> = {
    approved: ["approved", addDays(today, 1), addDays(today, 2)],
    out: ["out", addDays(today, -1), addDays(today, 2)],
    overdue: ["out", addDays(today, -4), addDays(today, -2)],
  };

  async function withLoans(loans: [Side, Kind][]) {
    const user = await scope.createTestUser();
    const other = await scope.createTestUser();
    for (const [side, kind] of loans) {
      const [status, startDate, endDate] = DATES[kind];
      const owner = side === "owned" ? user : other;
      const { id: itemId } = await scope.createItem({ ownerId: owner.id });
      await scope.createLoan({
        itemId,
        borrowerId: side === "owned" ? other.id : user.id,
        status,
        startDate,
        endDate,
      });
    }
    return (await getAccount(user.id, today)).deletion;
  }

  test.each([
    [[["owned", "out"]], "item_out"],
    [[["owned", "overdue"]], "item_out"],
    [[["borrowed", "out"]], "holding_item"],
    [[["borrowed", "overdue"]], "holding_item"],
    [
      [
        ["borrowed", "out"],
        ["owned", "out"],
      ],
      "item_out",
    ],
  ] as [[Side, Kind][], "item_out" | "holding_item"][])(
    "%j → %s",
    async (loans, reason) => {
      expect(await withLoans(loans)).toEqual({ allowed: false, reason });
    },
  );

  test("approved loans on either side don't block", async () => {
    expect(
      await withLoans([
        ["owned", "approved"],
        ["borrowed", "approved"],
      ]),
    ).toEqual({ allowed: true, reason: null });
  });

  // The shared database keeps two active organizers, so "the last one" is the
  // organizer count stubbed for one read.
  test("the last active organizer: last_organizer; an item out still comes first", async () => {
    const organizer = await scope.createTestUser({ role: "organizer" });
    vi.spyOn(db.user, "count").mockResolvedValueOnce(1);
    expect((await getAccount(organizer.id, today)).deletion).toEqual({
      allowed: false,
      reason: "last_organizer",
    });

    const { id: itemId } = await scope.createItem({ ownerId: organizer.id });
    const other = await scope.createTestUser();
    await scope.createLoan({
      itemId,
      borrowerId: other.id,
      status: "out",
      startDate: addDays(today, -1),
      endDate: addDays(today, 2),
    });
    vi.spyOn(db.user, "count").mockResolvedValueOnce(1);
    expect((await getAccount(organizer.id, today)).deletion.reason).toBe(
      "item_out",
    );
  });

  test("a member, or a suspended organizer, is never the last organizer", async () => {
    const member = await scope.createTestUser();
    const suspended = await scope.createTestUser({
      role: "organizer",
      status: "suspended",
    });
    for (const { id } of [member, suspended]) {
      vi.spyOn(db.user, "count").mockResolvedValueOnce(1);
      expect((await getAccount(id, today)).deletion).toEqual({
        allowed: true,
        reason: null,
      });
    }
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

    expect(
      await updateOwnContactDetails(user.id, "Phone 555\nAfter 6", today),
    ).toBe("saved");

    expect((await columns(user.id)).contactDetails).toBe("Phone 555\nAfter 6");
    expect((await columns(other.id)).contactDetails).toBeNull();
  });

  test("null clears the details while nothing locks them", async () => {
    const user = await scope.createTestUser();
    await updateOwnContactDetails(user.id, "Phone 555", today);

    expect(await updateOwnContactDetails(user.id, null, today)).toBe("saved");

    expect((await columns(user.id)).contactDetails).toBeNull();
    expect((await getAccount(user.id, today)).contactDetailsLocked).toBe(false);
  });
});

// Fixed dates so "today" never moves under the fixtures.
describe("the contact-details lock", () => {
  const TODAY = "2030-06-15";
  const DETAILS = "Phone 555";

  type Scenario = {
    item: ItemStatus;
    loan?: [LoanStatus, string, string];
    owner: boolean;
    borrower: boolean;
  };

  // Which side, if either, can't clear the details.
  const scenarios: [string, Scenario][] = [
    ["a listed item", { item: "listed", owner: true, borrower: false }],
    ["a hidden item", { item: "hidden", owner: false, borrower: false }],
    ["a retired item", { item: "retired", owner: false, borrower: false }],
    [
      "an open request",
      {
        item: "hidden",
        loan: ["requested", "2030-06-16", "2030-06-17"],
        owner: true,
        borrower: true,
      },
    ],
    [
      "an approved loan",
      {
        item: "hidden",
        loan: ["approved", "2030-06-16", "2030-06-17"],
        owner: true,
        borrower: true,
      },
    ],
    [
      "an out loan",
      {
        item: "hidden",
        loan: ["out", "2030-06-14", "2030-06-16"],
        owner: true,
        borrower: true,
      },
    ],
    [
      "an overdue out loan",
      {
        item: "hidden",
        loan: ["out", "2030-06-01", "2030-06-10"],
        owner: true,
        borrower: true,
      },
    ],
    [
      "an expired request",
      {
        item: "hidden",
        loan: ["requested", "2030-06-14", "2030-06-16"],
        owner: false,
        borrower: false,
      },
    ],
    [
      "a lapsed approval",
      {
        item: "hidden",
        loan: ["approved", "2030-06-10", "2030-06-14"],
        owner: false,
        borrower: false,
      },
    ],
    [
      "a returned loan",
      {
        item: "hidden",
        loan: ["returned", "2030-06-10", "2030-06-12"],
        owner: false,
        borrower: false,
      },
    ],
    [
      "a declined request",
      {
        item: "hidden",
        loan: ["declined", "2030-06-16", "2030-06-17"],
        owner: false,
        borrower: false,
      },
    ],
  ];

  test.each(scenarios)(
    "%s: the right sides are locked",
    async (_label, { item, loan, owner, borrower }) => {
      const ownerUser = await scope.createTestUser({ contactDetails: DETAILS });
      const borrowerUser = await scope.createTestUser({
        contactDetails: DETAILS,
      });
      const { id: itemId } = await scope.createItem({
        ownerId: ownerUser.id,
        status: item,
      });
      if (loan) {
        await scope.createLoan({
          itemId,
          borrowerId: borrowerUser.id,
          status: loan[0],
          startDate: loan[1],
          endDate: loan[2],
        });
      }

      expect((await getAccount(ownerUser.id, TODAY)).contactDetailsLocked).toBe(
        owner,
      );
      expect(
        (await getAccount(borrowerUser.id, TODAY)).contactDetailsLocked,
      ).toBe(borrower);
    },
  );

  test("a live loan whose borrower was deleted still locks its owner", async () => {
    const ownerUser = await scope.createTestUser({ contactDetails: DETAILS });
    const { id: itemId } = await scope.createItem({ ownerId: ownerUser.id });
    await scope.createLoan({
      itemId,
      borrowerId: null,
      status: "approved",
      startDate: "2030-06-16",
      endDate: "2030-06-17",
    });
    expect((await getAccount(ownerUser.id, TODAY)).contactDetailsLocked).toBe(
      true,
    );
  });

  test("a locked clear returns locked and writes nothing; a new value still saves", async () => {
    const user = await scope.createTestUser({ contactDetails: DETAILS });
    await scope.createItem({ ownerId: user.id, status: "listed" });

    expect(await updateOwnContactDetails(user.id, null, TODAY)).toBe("locked");
    expect((await columns(user.id)).contactDetails).toBe(DETAILS);

    expect(await updateOwnContactDetails(user.id, "Phone 777", TODAY)).toBe(
      "saved",
    );
    expect((await columns(user.id)).contactDetails).toBe("Phone 777");
  });

  test("the lock reads the given today: the same approval stops locking once it lapses", async () => {
    const user = await scope.createTestUser({ contactDetails: DETAILS });
    const { id: itemId } = await scope.createItem({ ownerId: user.id });
    await scope.createLoan({
      itemId,
      borrowerId: (await scope.createTestUser()).id,
      status: "approved",
      startDate: "2030-06-10",
      endDate: "2030-06-15",
    });

    expect((await getAccount(user.id, "2030-06-15")).contactDetailsLocked).toBe(
      true,
    );
    expect((await getAccount(user.id, "2030-06-16")).contactDetailsLocked).toBe(
      false,
    );
  });
});
