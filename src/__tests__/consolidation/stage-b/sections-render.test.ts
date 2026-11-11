import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createElement, type ReactNode } from "react";
import { prerender } from "react-dom/static";
import AccountSections from "@/components/account/AccountSections";
import InvitationsSection from "@/components/invitations/InvitationsSection";
import MembersSection from "@/components/members/MembersSection";
import { getAccount } from "@/data/account";
import { getOpenInvitations } from "@/data/invitations";
import { getAdminMembers } from "@/data/members";
import { getViewer } from "@/data/viewer";
import { communityToday } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { invitations } from "@/strings/invitations";
import { members } from "@/strings/members";
import type { AccountDTO } from "@/types/account";
import type { InvitationRowDTO } from "@/types/invitation";
import type { AdminMemberRowDTO } from "@/types/members";
import type { ViewerDTO } from "@/types/viewer";

vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
vi.mock("@/data/account", () => ({ getAccount: vi.fn() }));
vi.mock("@/data/invitations", () => ({ getOpenInvitations: vi.fn() }));
vi.mock("@/data/members", () => ({ getAdminMembers: vi.fn() }));
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
  needsActionCount: 0,
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

    expect(getAdminMembers).toHaveBeenCalledWith(q);
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
    };
    vi.mocked(getAccount).mockResolvedValue(details);

    await AccountSections();

    expect(getAccount).toHaveBeenCalledTimes(1);
    expect(getAccount).toHaveBeenCalledWith(member.id, communityToday());
  });
});
