import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import NavLink from "./NavLink";

vi.mock("next/navigation", () => ({ usePathname: vi.fn() }));

function renderBrowseAt(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  render(
    <NavLink href="/" activePrefixes={["/items"]}>
      Browse
    </NavLink>,
  );
  return screen.getByRole("link", { name: "Browse" });
}

describe("NavLink (Browse)", () => {
  // "page" on the linked page, "true" on a page inside its section (12a).
  test.each([
    ["/", "page"],
    ["/items/x", "true"],
  ])("is current on %s (%s)", (pathname, current) => {
    expect(renderBrowseAt(pathname)).toHaveAttribute("aria-current", current);
  });

  test.each(["/house-rules", "/itemsx", "/my/items"])(
    "is not current on %s",
    (pathname) => {
      expect(renderBrowseAt(pathname)).not.toHaveAttribute("aria-current");
    },
  );
});
