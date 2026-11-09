import { render, screen } from "@testing-library/react";
import Field from "./Field";
import TextInput from "./TextInput";

function renderField(props: { hint?: string; errors?: string[] }) {
  render(
    <Field id="email" label="Email" {...props}>
      {(control) => <TextInput name="email" {...control} />}
    </Field>,
  );
  return screen.getByRole("textbox", { name: "Email" });
}

describe("Field", () => {
  test("associates the label with the control", () => {
    const input = renderField({});
    expect(input).toHaveAttribute("id", "email");
  });

  test("no hint, no error: no aria-describedby, not invalid", () => {
    const input = renderField({});
    expect(input).not.toHaveAttribute("aria-describedby");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  test("describes the control with its hint", () => {
    const input = renderField({ hint: "We never show it to members." });
    expect(input).toHaveAccessibleDescription("We never show it to members.");
    expect(input).not.toHaveAttribute("aria-invalid");
  });

  test("with an error: describes it, marks the control invalid, shows only the first", () => {
    const input = renderField({
      hint: "We never show it to members.",
      errors: ["Enter an email address.", "Second error"],
    });
    expect(input).toHaveAttribute("aria-describedby", "email-hint email-error");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Enter an email address.")).toBeInTheDocument();
    expect(screen.queryByText("Second error")).not.toBeInTheDocument();
  });

  test("an empty errors list is not an error", () => {
    const input = renderField({ errors: [] });
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});
