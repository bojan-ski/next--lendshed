import { render, screen } from "@testing-library/react";
import Avatar from "./Avatar";

describe("Avatar", () => {
  test("shows the initials and forwards className and props to the root", () => {
    render(
      <Avatar
        initials="MK"
        className="ml-2"
        data-testid="avatar"
        aria-hidden
      />,
    );
    const avatar = screen.getByTestId("avatar");
    expect(avatar).toHaveTextContent("MK");
    expect(avatar).toHaveClass("ml-2", "rounded-full", "size-10");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
  });
});
