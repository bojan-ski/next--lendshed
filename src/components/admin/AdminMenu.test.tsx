import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { invitations } from "@/strings/invitations";
import { members } from "@/strings/members";
import AdminMenu from "./AdminMenu";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

function linksAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(<AdminMenu />);
  return {
    invitations: screen.getByRole("link", { name: invitations.title }),
    members: screen.getByRole("link", { name: members.title }),
  };
}

describe("AdminMenu", () => {
  test("lists Invitations then Members", () => {
    const links = linksAt("/admin");
    expect(links.invitations).toHaveAttribute("href", "/admin/invitations");
    expect(links.members).toHaveAttribute("href", "/admin/members");
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      [invitations.title, members.title],
    );
  });

  test.each(["/admin/members", "/admin/members/member-1"])(
    "Members is current on %s",
    (pathname) => {
      const links = linksAt(pathname);
      expect(links.members).toHaveAttribute("aria-current", "page");
      expect(links.invitations).not.toHaveAttribute("aria-current");
    },
  );

  test("Invitations is current only on its own page", () => {
    const links = linksAt("/admin/invitations");
    expect(links.invitations).toHaveAttribute("aria-current", "page");
    expect(links.members).not.toHaveAttribute("aria-current");
  });
});
