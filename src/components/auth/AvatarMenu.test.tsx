import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signOut } from "@/actions/auth";
import { t } from "@/lib/text/interpolate";
import { avatarMenu } from "@/strings/avatarMenu";
import AvatarMenu from "./AvatarMenu";

vi.mock("@/actions/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));

const viewer = { displayName: "Mira K.", initials: "MK" };

describe("AvatarMenu", () => {
  test("names the disclosure after the viewer and shows the initials", () => {
    const { container } = render(<AvatarMenu viewer={viewer} />);
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveAccessibleName(
      t(avatarMenu.label, { name: viewer.displayName }),
    );
    expect(summary).toHaveTextContent("MK");
  });

  // jsdom doesn't map Enter on <summary> to activation (browsers do natively),
  // so this proves focusability plus activation; the key itself is a browser check.
  test("takes keyboard focus, opens on activation, and Sign out posts signOut", async () => {
    const { container } = render(<AvatarMenu viewer={viewer} />);
    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    expect(details).not.toHaveAttribute("open");

    await userEvent.tab();
    expect(summary).toHaveFocus();
    await userEvent.click(summary);
    expect(details).toHaveAttribute("open");

    const button = screen.getByRole("button", { name: avatarMenu.signOut });
    expect(button).toHaveAttribute("type", "submit");
    expect(button.closest("form")).not.toBeNull();
    await userEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
