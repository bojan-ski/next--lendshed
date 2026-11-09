import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fields } from "@/strings/fields";
import PasswordInput from "./PasswordInput";

describe("PasswordInput", () => {
  test("the toggle flips the type and its accessible name, and never submits", async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    const { container } = render(
      <form onSubmit={onSubmit}>
        <label htmlFor="password">Password</label>
        <PasswordInput id="password" name="password" />
      </form>,
    );
    const input = container.querySelector("input")!;
    expect(input).toHaveAttribute("type", "password");

    await userEvent.click(
      screen.getByRole("button", { name: fields.showPassword }),
    );
    expect(input).toHaveAttribute("type", "text");

    await userEvent.click(
      screen.getByRole("button", { name: fields.hidePassword }),
    );
    expect(input).toHaveAttribute("type", "password");

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
