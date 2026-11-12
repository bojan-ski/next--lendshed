import { render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import OrganizerNavSlot from "@/components/admin/OrganizerNavSlot";
import { getViewer } from "@/data/viewer";
import { nav } from "@/strings/nav";
import type { ViewerDTO } from "@/types/viewer";
import MemberHeader from "./MemberHeader";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/") }));
vi.mock("@/data/viewer", () => ({ getViewer: vi.fn() }));
// The islands project loads no env; the wordmark's alt text reads the public env.
vi.mock("@/components/shell/Wordmark", () => ({ default: () => null }));

const member: ViewerDTO = {
  id: "u1",
  displayName: "Mira K.",
  initials: "MK",
  role: "member",
};

// The slot is an async Server Component: resolve it, then render its output.
async function renderWithSlotFor(viewer: ViewerDTO | null) {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  const entry = (await OrganizerNavSlot()) as ReactNode;
  render(<MemberHeader organizerEntry={entry} />);
  return screen.getByRole("navigation", { name: nav.label });
}

describe("MemberHeader", () => {
  test("without the slots it has Browse, My loans, then My items", () => {
    render(<MemberHeader />);
    const navigation = screen.getByRole("navigation", { name: nav.label });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      nav.browse,
      nav.myLoans,
      nav.myItems,
    ]);
    expect(links[1]).toHaveAttribute("href", "/my/loans");
    expect(links[2]).toHaveAttribute("href", "/my/items");
  });

  // "page" only on the linked page itself; "true" for a page inside its section
  // (12a, route/a11y auditors).
  test.each([
    ["/my/items", "page"],
    ["/my/items/new", "true"],
    ["/my/items/item-1/edit", "true"],
  ])(
    "My items is current on %s (%s), and Browse isn't",
    (pathname, current) => {
      vi.mocked(usePathname).mockReturnValue(pathname);
      render(<MemberHeader />);
      const navigation = screen.getByRole("navigation", { name: nav.label });
      expect(
        within(navigation).getByRole("link", { name: nav.myItems }),
      ).toHaveAttribute("aria-current", current);
      expect(
        within(navigation).getByRole("link", { name: nav.browse }),
      ).not.toHaveAttribute("aria-current");
    },
  );

  test.each([
    ["/my/loans", "page"],
    ["/loans/loan-1", "true"],
  ])(
    "My loans is current on %s (%s); My items and Browse aren't",
    (pathname, current) => {
      vi.mocked(usePathname).mockReturnValue(pathname);
      render(<MemberHeader />);
      const navigation = screen.getByRole("navigation", { name: nav.label });
      expect(
        within(navigation).getByRole("link", { name: nav.myLoans }),
      ).toHaveAttribute("aria-current", current);
      for (const name of [nav.myItems, nav.browse]) {
        expect(
          within(navigation).getByRole("link", { name }),
        ).not.toHaveAttribute("aria-current");
      }
    },
  );

  test("My loans is not current on /my/items", () => {
    vi.mocked(usePathname).mockReturnValue("/my/items");
    render(<MemberHeader />);
    const navigation = screen.getByRole("navigation", { name: nav.label });
    expect(
      within(navigation).getByRole("link", { name: nav.myLoans }),
    ).not.toHaveAttribute("aria-current");
  });

  test("the badge slot renders inside the My loans link, after its label", () => {
    render(
      <MemberHeader
        myLoansBadge={
          <>
            {" "}
            <span>2 need you</span>
          </>
        }
      />,
    );
    const navigation = screen.getByRole("navigation", { name: nav.label });
    const myLoans = within(navigation).getByRole("link", {
      name: `${nav.myLoans} 2 need you`,
    });
    expect(myLoans).toHaveAttribute("href", "/my/loans");
    expect(myLoans.textContent).toBe(`${nav.myLoans} 2 need you`);
    expect(
      within(navigation).getByRole("link", { name: nav.myItems }),
    ).not.toHaveTextContent("2 need you");
  });

  test("an organizer gets Organizer as the last entry, linking to /admin", async () => {
    const navigation = await renderWithSlotFor({
      ...member,
      role: "organizer",
    });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      nav.browse,
      nav.myLoans,
      nav.myItems,
      nav.organizer,
    ]);
    expect(links[3]).toHaveAttribute("href", "/admin");
    expect(within(navigation).getAllByRole("listitem")).toHaveLength(4);
  });

  test.each([
    ["/admin", "page"],
    ["/admin/invitations", "true"],
  ])("Organizer is current on %s (%s)", async (pathname, current) => {
    vi.mocked(usePathname).mockReturnValue(pathname);
    const navigation = await renderWithSlotFor({
      ...member,
      role: "organizer",
    });
    expect(
      within(navigation).getByRole("link", { name: nav.organizer }),
    ).toHaveAttribute("aria-current", current);
  });

  test.each([
    ["a member", member],
    ["no viewer", null],
  ])("%s gets no Organizer entry and no empty item", async (_label, viewer) => {
    const navigation = await renderWithSlotFor(viewer);
    expect(
      within(navigation).queryByRole("link", { name: nav.organizer }),
    ).toBeNull();
    expect(within(navigation).getAllByRole("listitem")).toHaveLength(3);
  });
});
