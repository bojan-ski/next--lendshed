import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { categories } from "@/strings/categories";
import { invitations } from "@/strings/invitations";
import { members } from "@/strings/members";
import { usage } from "@/strings/usage";
import AdminMenu from "./AdminMenu";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

function linksAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(<AdminMenu />);
  return {
    invitations: screen.getByRole("link", { name: invitations.title }),
    members: screen.getByRole("link", { name: members.title }),
    categories: screen.getByRole("link", { name: categories.title }),
    usage: screen.getByRole("link", { name: usage.title }),
  };
}

describe("AdminMenu", () => {
  test("lists Invitations, Members, Categories, then Usage", () => {
    const links = linksAt("/admin");
    expect(links.invitations).toHaveAttribute("href", "/admin/invitations");
    expect(links.members).toHaveAttribute("href", "/admin/members");
    expect(links.categories).toHaveAttribute("href", "/admin/categories");
    expect(links.usage).toHaveAttribute("href", "/admin/usage");
    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      [invitations.title, members.title, categories.title, usage.title],
    );
  });

  test("Usage is current only on its own page", () => {
    const links = linksAt("/admin/usage");
    expect(links.usage).toHaveAttribute("aria-current", "page");
    expect(links.categories).not.toHaveAttribute("aria-current");
    expect(links.members).not.toHaveAttribute("aria-current");
  });

  test("Categories is current only on its own page", () => {
    const links = linksAt("/admin/categories");
    expect(links.categories).toHaveAttribute("aria-current", "page");
    expect(links.members).not.toHaveAttribute("aria-current");
    expect(links.invitations).not.toHaveAttribute("aria-current");
  });

  test.each([
    ["/admin/members", "page"],
    ["/admin/members/member-1", "true"],
  ])("Members is current on %s (%s)", (pathname, current) => {
    const links = linksAt(pathname);
    expect(links.members).toHaveAttribute("aria-current", current);
    expect(links.invitations).not.toHaveAttribute("aria-current");
  });

  test("Invitations is current only on its own page", () => {
    const links = linksAt("/admin/invitations");
    expect(links.invitations).toHaveAttribute("aria-current", "page");
    expect(links.members).not.toHaveAttribute("aria-current");
  });
});
