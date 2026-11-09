import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signIn } from "@/actions/auth";
import { errors } from "@/strings/errors";
import { login } from "@/strings/login";
import type { SignInState } from "@/types/auth";
import LoginForm from "./LoginForm";

vi.mock("@/actions/auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));

async function submitWith(state: SignInState) {
  vi.mocked(signIn).mockResolvedValue(state);
  render(<LoginForm />);
  await userEvent.type(
    screen.getByLabelText(login.emailLabel),
    "mira@example.com",
  );
  await userEvent.type(
    screen.getByLabelText(login.passwordLabel),
    "not-the-password",
  );
  await userEvent.click(screen.getByRole("button", { name: login.submit }));
}

describe("LoginForm", () => {
  test("renders the fields and no notice before a submit", () => {
    render(<LoginForm />);
    expect(screen.getByLabelText(login.emailLabel)).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.getByLabelText(login.passwordLabel)).toHaveAttribute(
      "type",
      "password",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("passes next through untouched as a hidden input", () => {
    const { container } = render(<LoginForm next="//evil.com" />);
    expect(
      container.querySelector('input[type="hidden"][name="next"]'),
    ).toHaveValue("//evil.com");
  });

  test("renders no next input without one", () => {
    const { container } = render(<LoginForm />);
    expect(container.querySelector('input[name="next"]')).toBeNull();
  });

  test.each([
    ["invalidCredentials", login.invalidCredentials],
    ["suspended", login.suspended],
    ["tooManyAttempts", login.tooManyAttempts],
    ["unexpected", errors.actionFailed],
  ] as const)(
    "a %s refusal shows its notice, keeps the email and clears the password",
    async (formError, text) => {
      await submitWith({ formError, email: "mira@example.com" });
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.getByLabelText(login.emailLabel)).toHaveValue(
        "mira@example.com",
      );
      expect(screen.getByLabelText(login.passwordLabel)).toHaveValue("");
    },
  );

  test("field errors render under their fields and mark them invalid", async () => {
    await submitWith({
      fieldErrors: {
        email: [login.emailInvalid],
        password: [login.passwordRequired],
      },
      email: "mira@",
    });
    const email = screen.getByLabelText(login.emailLabel);
    expect(await screen.findByText(login.emailInvalid)).toBeInTheDocument();
    expect(screen.getByText(login.passwordRequired)).toBeInTheDocument();
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription(login.emailInvalid);
    expect(email).toHaveValue("mira@");
  });
});
