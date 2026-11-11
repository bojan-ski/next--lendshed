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
  needsActionCount: 0,
};

// The slot is an async Server Component: resolve it, then render its output.
async function renderWithSlotFor(viewer: ViewerDTO | null) {
  vi.mocked(getViewer).mockResolvedValue(viewer);
  const entry = (await OrganizerNavSlot()) as ReactNode;
  render(<MemberHeader organizerEntry={entry} />);
  return screen.getByRole("navigation", { name: nav.label });
}

describe("MemberHeader", () => {
  test("without the slot it has Browse, then My items", () => {
    render(<MemberHeader />);
    const navigation = screen.getByRole("navigation", { name: nav.label });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      nav.browse,
      nav.myItems,
    ]);
    expect(links[1]).toHaveAttribute("href", "/my/items");
  });

  test.each(["/my/items", "/my/items/new", "/my/items/item-1/edit"])(
    "My items is current on %s, and Browse isn't",
    (pathname) => {
      vi.mocked(usePathname).mockReturnValue(pathname);
      render(<MemberHeader />);
      const navigation = screen.getByRole("navigation", { name: nav.label });
      expect(
        within(navigation).getByRole("link", { name: nav.myItems }),
      ).toHaveAttribute("aria-current", "page");
      expect(
        within(navigation).getByRole("link", { name: nav.browse }),
      ).not.toHaveAttribute("aria-current");
    },
  );

  test("an organizer gets Organizer as the last entry, linking to /admin", async () => {
    const navigation = await renderWithSlotFor({
      ...member,
      role: "organizer",
    });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      nav.browse,
      nav.myItems,
      nav.organizer,
    ]);
    expect(links[2]).toHaveAttribute("href", "/admin");
    expect(within(navigation).getAllByRole("listitem")).toHaveLength(3);
  });

  test.each(["/admin", "/admin/invitations"])(
    "Organizer is current on %s",
    async (pathname) => {
      vi.mocked(usePathname).mockReturnValue(pathname);
      const navigation = await renderWithSlotFor({
        ...member,
        role: "organizer",
      });
      expect(
        within(navigation).getByRole("link", { name: nav.organizer }),
      ).toHaveAttribute("aria-current", "page");
    },
  );

  test.each([
    ["a member", member],
    ["no viewer", null],
  ])("%s gets no Organizer entry and no empty item", async (_label, viewer) => {
    const navigation = await renderWithSlotFor(viewer);
    expect(
      within(navigation).queryByRole("link", { name: nav.organizer }),
    ).toBeNull();
    expect(within(navigation).getAllByRole("listitem")).toHaveLength(2);
  });
});
