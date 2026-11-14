import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createElement, isValidElement, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import AccountCard from "@/components/account/AccountCard";
import AccountSections from "@/components/account/AccountSections";
import DeleteAccountButton from "@/components/account/DeleteAccountButton";
import InvitationsSection from "@/components/invitations/InvitationsSection";
import ItemDetailsForm from "@/components/items/ItemDetailsForm";
import ItemEditSection from "@/components/items/ItemEditSection";
import NewItemSection from "@/components/items/NewItemSection";
import OwnItemsSection from "@/components/items/OwnItemsSection";
import MemberOpenLoans from "@/components/members/MemberOpenLoans";
import MembersSection from "@/components/members/MembersSection";
import { getAccount } from "@/data/account";
import { getCategories } from "@/data/categories";
import { getOpenInvitations } from "@/data/invitations";
import { countActiveOwnItems, getItemForEdit, getOwnItems } from "@/data/items";
import { getAdminMembers } from "@/data/members";
import { getViewer } from "@/data/viewer";
import { communityToday, formatDate } from "@/lib/dates/dates";
import { ITEM_CAP } from "@/lib/schemas/items";
import { t } from "@/lib/text/interpolate";
import { loanStatus } from "@/lib/text/status";
import { account } from "@/strings/account";
import { invitations } from "@/strings/invitations";
import { items } from "@/strings/items";
import { members } from "@/strings/members";
import type { AccountDTO } from "@/types/account";
import type { InvitationRowDTO } from "@/types/invitation";
import type { ItemEditDTO, OwnItemRowDTO } from "@/types/item";
import type { AdminMemberOpenLoan, AdminMemberRowDTO } from "@/types/members";
import type { ViewerDTO } from "@/types/viewer";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/data/account", () => ({ getAccount: vi.fn() }));
vi.mock("@/data/invitations", () => ({ getOpenInvitations: vi.fn() }));
vi.mock("@/data/members", () => ({ getAdminMembers: vi.fn() }));
vi.mock("@/data/categories", () => ({ getCategories: vi.fn() }));
vi.mock("@/data/items", () => ({
  getOwnItems: vi.fn(),
  countActiveOwnItems: vi.fn(),
  getItemForEdit: vi.fn(),
}));
// next/form needs the app router; a plain GET form stands in.
vi.mock("next/form", () => ({
  default: ({ children, ...props }: { children: ReactNode }) =>
    createElement("form", { method: "get", ...props }, children),
}));

const member: ViewerDTO = {
  id: "u1",
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
};
const organizer: ViewerDTO = { ...member, role: "organizer" };

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#x27;": "'",
};

async function html(tree: unknown): Promise<string> {
  const { prelude } = await prerender(tree as ReactNode);
  return (await new Response(prelude).text())
    .replace(/<!-- -->/g, "")
    .replace(/&(?:amp|lt|gt|quot|#x27);/g, (entity) => ENTITIES[entity]);
}

// The unrendered elements of `type` in a section's tree, children included.
function elementsOf(
  tree: unknown,
  type: unknown,
): { props: Record<string, never> }[] {
  if (Array.isArray(tree))
    return tree.flatMap((node) => elementsOf(node, type));
  if (!isValidElement<{ children?: unknown }>(tree)) return [];
  const own = tree.type === type ? [tree as never] : [];
  return [...own, ...elementsOf(tree.props.children, type)];
}

function statusLine(page: string): string | undefined {
  return /<p role="status"[^>]*>([^<]*)<\/p>/.exec(page)?.[1];
}

const row = (n: number): AdminMemberRowDTO => ({
  id: `m${n}`,
  displayName: `Ana P${n}.`,
  initials: "AP",
  role: "member",
  status: "active",
  openLoanCount: 0,
});

describe("InvitationsSection", () => {
  test("no open invitations: the empty state, no table", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    vi.mocked(getOpenInvitations).mockResolvedValue([]);

    const page = await html(await InvitationsSection());

    expect(page).toContain(invitations.emptyHeading);
    expect(page).toContain(invitations.emptyBody);
    expect(page).not.toContain("<table");
  });

  test("open invitations: the table, no empty state", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    const invitation: InvitationRowDTO = {
      id: "i1",
      note: "For Ana's neighbour",
      expiresAt: "2026-11-17T10:00:00.000Z",
      createdByName: "Ruth K.",
    };
    vi.mocked(getOpenInvitations).mockResolvedValue([invitation]);

    const page = await html(await InvitationsSection());

    expect(page).toContain("<table");
    expect(page).toContain(invitation.note);
    expect(page).not.toContain(invitations.emptyHeading);
  });
});

describe("MembersSection", () => {
  test.each([
    [0, "", t(members.countOther, { count: 0 })],
    [1, "", t(members.countOne, { count: 1 })],
    [2, "", t(members.countOther, { count: 2 })],
    [0, "zed", t(members.matchesOther, { count: 0, q: "zed" })],
    [1, "ana", t(members.matchesOne, { count: 1, q: "ana" })],
    [2, "ana", t(members.matchesOther, { count: 2, q: "ana" })],
  ])("%i rows for q=%j: the status line says so", async (count, q, line) => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    vi.mocked(getAdminMembers).mockResolvedValue(
      Array.from({ length: count }, (_, n) => row(n)),
    );

    const page = await html(
      await MembersSection({ searchParams: Promise.resolve({ q }) }),
    );

    expect(getAdminMembers).toHaveBeenCalledWith(
      q,
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    expect(statusLine(page)).toBe(line);
  });

  test("no match: the empty state names the search and offers everyone", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    vi.mocked(getAdminMembers).mockResolvedValue([]);

    const page = await html(
      await MembersSection({ searchParams: Promise.resolve({ q: "zed" }) }),
    );

    expect(page).toContain(t(members.emptyHeading, { q: "zed" }));
    expect(page).toContain(members.emptyBody);
    expect(page).toContain(`href="/admin/members"`);
    expect(page).not.toContain("<table");
  });

  test("rows: the table, no empty state", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    vi.mocked(getAdminMembers).mockResolvedValue([row(1)]);

    const page = await html(
      await MembersSection({ searchParams: Promise.resolve({}) }),
    );

    expect(page).toContain("<table");
    expect(page).not.toContain(members.emptyBody);
  });

  test("rows show their real open-loan counts", async () => {
    vi.mocked(getViewer).mockResolvedValue(organizer);
    vi.mocked(getAdminMembers).mockResolvedValue([
      { ...row(1), openLoanCount: 1 },
      { ...row(2), openLoanCount: 3 },
    ]);

    const page = await html(
      await MembersSection({ searchParams: Promise.resolve({}) }),
    );

    expect(page).toContain(t(members.openLoansOne, { count: 1 }));
    expect(page).toContain(t(members.openLoansOther, { count: 3 }));
  });
});

describe("MemberOpenLoans", () => {
  const today = "2026-11-13";
  const loans: AdminMemberOpenLoan[] = [
    {
      id: "l1",
      itemTitle: "Ladder 3 m",
      side: "borrowed",
      otherPartyName: "Ada P.",
      status: "overdue",
      endDate: "2026-11-12",
    },
    {
      id: "l2",
      itemTitle: "Hedge trimmer",
      side: "lent",
      otherPartyName: "Tom B.",
      status: "out",
      endDate: "2026-11-21",
    },
  ];

  test("no open loans: the empty line", async () => {
    const page = await html(
      MemberOpenLoans({ loans: [], suspended: true, today }),
    );
    expect(page).toContain(members.noOpenLoans);
    expect(page).not.toContain(members.awaitsOrganizerClose);
  });

  test("each loan is a link to its page with title, side, status and end date", async () => {
    const page = await html(
      MemberOpenLoans({ loans, suspended: false, today }),
    );
    expect(page).toContain('href="/loans/l1"');
    expect(page).toContain('href="/loans/l2"');
    expect(page.indexOf("Ladder 3 m")).toBeLessThan(
      page.indexOf("Hedge trimmer"),
    );
    expect(page).toContain(t(members.borrowedFrom, { name: "Ada P." }));
    expect(page).toContain(t(members.lentTo, { name: "Tom B." }));
    expect(page).toContain(loanStatus.overdue.label);
    expect(page).toContain(loanStatus.out.label);
    expect(page).toContain(
      t(members.until, { date: formatDate("2026-11-21", today) }),
    );
    expect(page).not.toContain(members.awaitsOrganizerClose);
  });

  test("a suspended member's open loans add the organizer-close line", async () => {
    const page = await html(MemberOpenLoans({ loans, suspended: true, today }));
    expect(page).toContain(members.awaitsOrganizerClose);
  });
});

// /account guards itself too: the (app) layout doesn't re-run on a soft
// navigation, and the section reads only the viewer's own account.
describe("AccountSections", () => {
  test("a guest is redirected to /login before the account is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);

    const error = await AccountSections().then(
      () => {
        throw new Error("expected a throw");
      },
      (thrown: unknown) => thrown,
    );

    if (!isRedirectError(error)) throw error;
    expect(error.digest.split(";")[2]).toBe("/login");
    expect(getAccount).not.toHaveBeenCalled();
  });

  test("a member reads their own account, by their own id", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    const details: AccountDTO = {
      displayName: "Mira K.",
      area: null,
      contactDetails: null,
      email: "mira@example.test",
      contactDetailsLocked: false,
      deletion: { allowed: true, reason: null },
    };
    vi.mocked(getAccount).mockResolvedValue(details);

    await AccountSections();

    expect(getAccount).toHaveBeenCalledTimes(1);
    expect(getAccount).toHaveBeenCalledWith(member.id, communityToday());
  });

  // Spec 20: the fifth card, after Sign out.
  const accountWith = (deletion: AccountDTO["deletion"]): AccountDTO => ({
    displayName: "Mira K.",
    area: null,
    contactDetails: null,
    email: "mira@example.test",
    contactDetailsLocked: false,
    deletion,
  });
  const paragraphs = (tree: unknown) =>
    elementsOf(tree, "p").map(({ props }) => props.children as unknown);

  test.each([
    [member, false],
    [organizer, true],
  ] as const)(
    "deletion allowed: the muted line and the confirm control (%o → isOrganizer %s)",
    async (viewer, isOrganizer) => {
      vi.mocked(getViewer).mockResolvedValue(viewer);
      vi.mocked(getAccount).mockResolvedValue(
        accountWith({ allowed: true, reason: null }),
      );

      const tree = await AccountSections();

      const cards = elementsOf(tree, AccountCard);
      expect(cards.map(({ props }) => props.id)).toEqual([
        "profile",
        "contact",
        "password",
        "sign-out",
        "delete-account",
      ]);
      expect(cards.at(-1)?.props.heading).toBe(account.deleteHeading);
      const buttons = elementsOf(tree, DeleteAccountButton);
      expect(buttons.map(({ props }) => props)).toEqual([{ isOrganizer }]);
      expect(paragraphs(tree)).toContain(account.deleteBody);
    },
  );

  test.each([
    ["item_out", account.deleteBlockedItemOut],
    ["holding_item", account.deleteBlockedHolding],
    ["last_organizer", account.deleteBlockedLastOrganizer],
  ] as const)(
    "deletion refused for %s: the reason line and no control",
    async (reason, text) => {
      vi.mocked(getViewer).mockResolvedValue(organizer);
      vi.mocked(getAccount).mockResolvedValue(
        accountWith({ allowed: false, reason }),
      );

      const tree = await AccountSections();

      expect(elementsOf(tree, DeleteAccountButton)).toEqual([]);
      expect(paragraphs(tree)).toContain(text);
      expect(paragraphs(tree)).not.toContain(account.deleteBody);
    },
  );
});

// Spec 10: the three /my/items sections guard themselves the same way.
async function thrown(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected a throw");
    },
    (error: unknown) => error,
  );
}

function expectLoginRedirect(error: unknown) {
  if (!isRedirectError(error)) throw error;
  expect(error.digest.split(";")[2]).toBe("/login");
}

const CATEGORIES = [{ id: "cat-1", name: "Garden" }];

const ownRow = (
  n: number,
  overrides: Partial<OwnItemRowDTO> = {},
): OwnItemRowDTO => ({
  id: `item-${n}`,
  title: `Ladder ${n}`,
  status: "hidden",
  photo: null,
  now: { kind: "hidden", personName: null },
  ...overrides,
});

const editItem = (overrides: Partial<ItemEditDTO> = {}): ItemEditDTO => ({
  id: "item-1",
  title: "Cordless drill",
  description: "",
  categoryId: "cat-1",
  condition: "good",
  maxLoanDays: 7,
  pickupNotes: null,
  status: "hidden",
  photo: null,
  retiredNote: null,
  hasAnyLoan: false,
  hasBlockingLoan: false,
  ownerHasContactDetails: true,
  ...overrides,
});

const editParams = { params: Promise.resolve({ id: "item-1" }) };

describe("OwnItemsSection", () => {
  test("a guest is redirected to /login before the items are read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expectLoginRedirect(await thrown(OwnItemsSection()));
    expect(getOwnItems).not.toHaveBeenCalled();
  });

  test("no items: the empty state with Add item, no table", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(getOwnItems).mockResolvedValue({
      rows: [],
      activeCount: 0,
      cap: ITEM_CAP,
    });

    const page = await html(await OwnItemsSection());

    expect(getOwnItems).toHaveBeenCalledWith(member.id, communityToday());
    expect(page).toContain(items.emptyHeading);
    expect(page).toContain(`href="/my/items/new"`);
    expect(page).not.toContain("<table");
  });

  test("rows: the count line, Add item and a labelled Edit or View per row", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(getOwnItems).mockResolvedValue({
      rows: [
        ownRow(1, {
          status: "listed",
          now: { kind: "overdue", personName: "Ana P." },
        }),
        ownRow(2, {
          status: "retired",
          now: { kind: "retired", personName: null },
        }),
      ],
      activeCount: 1,
      cap: ITEM_CAP,
    });

    const page = await html(await OwnItemsSection());

    expect(page).toContain("<table");
    expect(page).toContain(t(items.countLine, { count: 1, cap: ITEM_CAP }));
    expect(page).toContain(`href="/my/items/new"`);
    expect(page).not.toContain(t(items.capLine, { cap: ITEM_CAP }));
    expect(page).toContain(t(items.now.overdue, { name: "Ana P." }));
    expect(page).toContain(t(items.editFor, { title: "Ladder 1" }));
    expect(page).toContain(t(items.viewFor, { title: "Ladder 2" }));
    expect(page).toContain(`href="/my/items/item-2/edit"`);
  });

  test("at the cap the cap line replaces Add item", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(getOwnItems).mockResolvedValue({
      rows: [ownRow(1)],
      activeCount: ITEM_CAP,
      cap: ITEM_CAP,
    });

    const page = await html(await OwnItemsSection());

    expect(page).toContain(t(items.capLine, { cap: ITEM_CAP }));
    expect(page).not.toContain(`href="/my/items/new"`);
  });
});

describe("NewItemSection", () => {
  test("a guest is redirected to /login before anything is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expectLoginRedirect(await thrown(NewItemSection()));
    expect(countActiveOwnItems).not.toHaveBeenCalled();
  });

  test("under the cap: the step line and the form", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(countActiveOwnItems).mockResolvedValue(ITEM_CAP - 1);
    vi.mocked(getCategories).mockResolvedValue(CATEGORIES);

    const page = await html(await NewItemSection());

    expect(countActiveOwnItems).toHaveBeenCalledWith(member.id);
    expect(page).toContain(items.stepDetails);
    expect(page).toContain(items.saveAndContinue);
    expect(page).toContain("Garden");
  });

  test("at the cap: the notice and a way back, no form", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(countActiveOwnItems).mockResolvedValue(ITEM_CAP);
    vi.mocked(getCategories).mockResolvedValue(CATEGORIES);

    const page = await html(await NewItemSection());

    expect(page).toContain(t(items.capNotice, { cap: ITEM_CAP }));
    expect(page).toContain(`href="/my/items"`);
    expect(page).not.toContain("<form");
  });

  test("no categories: the ask-an-organizer notice, no form", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(countActiveOwnItems).mockResolvedValue(0);
    vi.mocked(getCategories).mockResolvedValue([]);

    const page = await html(await NewItemSection());

    expect(page).toContain(items.noCategories);
    expect(page).not.toContain("<form");
  });
});

describe("ItemEditSection", () => {
  test("a guest is redirected to /login before the item is read", async () => {
    vi.mocked(getViewer).mockResolvedValue(null);
    expectLoginRedirect(await thrown(ItemEditSection(editParams)));
    expect(getItemForEdit).not.toHaveBeenCalled();
  });

  test("an item that isn't the viewer's (null) is not-found", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(getItemForEdit).mockResolvedValue(null);
    vi.mocked(getCategories).mockResolvedValue(CATEGORIES);

    const error = await thrown(ItemEditSection(editParams));

    expect(getItemForEdit).toHaveBeenCalledWith(
      member.id,
      "item-1",
      communityToday(),
    );
    expect((error as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });

  test.each([
    ["no loan rows", {}, items.delete, [items.retire, items.blockedLine]],
    [
      "loans, none blocking",
      { hasAnyLoan: true },
      items.retire,
      [items.delete, items.blockedLine],
    ],
    [
      "a blocking loan",
      { hasAnyLoan: true, hasBlockingLoan: true },
      items.blockedLine,
      [items.retire, items.delete],
    ],
  ] as const)(
    "%s: the last card shows exactly that control",
    async (_label, flags, shown, absent) => {
      vi.mocked(getViewer).mockResolvedValue(member);
      vi.mocked(getItemForEdit).mockResolvedValue(editItem(flags));
      vi.mocked(getCategories).mockResolvedValue(CATEGORIES);

      const page = await html(await ItemEditSection(editParams));

      expect(page).toContain(items.visibilityHidden);
      expect(page).toContain(items.list);
      expect(page).toContain(items.saveChanges);
      expect(page).toContain(shown);
      for (const text of absent) expect(page).not.toContain(text);
    },
  );

  test("a retired item is read-only: its details and note, no form or button", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(getItemForEdit).mockResolvedValue(
      editItem({
        status: "retired",
        hasAnyLoan: true,
        retiredNote: "Handle broke",
      }),
    );
    vi.mocked(getCategories).mockResolvedValue(CATEGORIES);

    const page = await html(await ItemEditSection(editParams));

    expect(page).toContain(items.retiredLine);
    expect(page).toContain("Garden");
    expect(page).toContain(items.retiredNoteLabel);
    expect(page).toContain("Handle broke");
    expect(page).not.toContain("<form");
    expect(page).not.toContain("<button");
  });

  // Island props serialise to the browser: the details form gets its seven
  // fields, never the page's whole DTO (12a, contract-auditor).
  test("the details island receives only the id and the six detail fields", async () => {
    vi.mocked(getViewer).mockResolvedValue(member);
    vi.mocked(getItemForEdit).mockResolvedValue(editItem());
    vi.mocked(getCategories).mockResolvedValue(CATEGORIES);

    const [form] = elementsOf(
      await ItemEditSection(editParams),
      ItemDetailsForm,
    );

    expect(Object.keys(form.props.item).sort()).toEqual(
      [
        "id",
        "title",
        "description",
        "categoryId",
        "condition",
        "maxLoanDays",
        "pickupNotes",
      ].sort(),
    );
  });
});
