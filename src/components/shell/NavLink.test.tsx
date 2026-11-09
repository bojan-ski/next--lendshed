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
  test.each(["/", "/items/x"])("is current on %s", (pathname) => {
    expect(renderBrowseAt(pathname)).toHaveAttribute("aria-current", "page");
  });

  test.each(["/house-rules", "/itemsx", "/my/items"])(
    "is not current on %s",
    (pathname) => {
      expect(renderBrowseAt(pathname)).not.toHaveAttribute("aria-current");
    },
  );
});
