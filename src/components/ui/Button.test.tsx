import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Button from "./Button";

describe("Button", () => {
  test("a submit button disables itself and sets aria-busy while its form is pending", async () => {
    const neverSettles = () => new Promise<void>(() => {});
    render(
      <form action={neverSettles}>
        <Button type="submit">Save</Button>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");

    await userEvent.click(button);
    expect(await screen.findByRole("button", { name: "Save" })).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  test("an explicit pending prop does the same outside a form", () => {
    render(<Button pending>Approve</Button>);
    const button = screen.getByRole("button", { name: "Approve" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  test("defaults to type=button so it never submits by accident", () => {
    render(<Button>Cancel</Button>);
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "type",
      "button",
    );
  });
});
