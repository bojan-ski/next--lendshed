import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetPasswordWithGrant } from "@/actions/reset";
import { errors } from "@/strings/errors";
import { linkBroken } from "@/strings/linkBroken";
import { resetPassword } from "@/strings/resetPassword";
import type { ResetPasswordState } from "@/types/auth";
import ResetPasswordForm from "./ResetPasswordForm";

vi.mock("@/actions/reset", () => ({ resetPasswordWithGrant: vi.fn() }));

const TOKEN = "A".repeat(43);
const TYPED = "typed-password";

const passwordField = () => screen.getByLabelText(resetPassword.passwordLabel);

async function submitWith(state: ResetPasswordState) {
  vi.mocked(resetPasswordWithGrant).mockResolvedValue(state);
  render(<ResetPasswordForm token={TOKEN} />);
  await userEvent.type(passwordField(), TYPED);
  await userEvent.click(
    screen.getByRole("button", { name: resetPassword.submit }),
  );
}

describe("ResetPasswordForm", () => {
  test("renders the heading, one new-password field and the token as a hidden input", () => {
    const { container } = render(<ResetPasswordForm token={TOKEN} />);
    expect(
      screen.getByRole("heading", { level: 1, name: resetPassword.heading }),
    ).toBeInTheDocument();
    expect(passwordField()).toHaveAttribute("autocomplete", "new-password");
    expect(screen.getByText(resetPassword.passwordHint)).toBeInTheDocument();
    expect(
      container.querySelector<HTMLInputElement>('input[name="token"]')?.value,
    ).toBe(TOKEN);
    expect(container.querySelectorAll("input:not([type=hidden])")).toHaveLength(
      1,
    );
  });

  test("sends the token and the typed password", async () => {
    await submitWith({ formError: "unexpected" });
    const formData = vi.mocked(resetPasswordWithGrant).mock.calls[0][1];
    expect(formData.get("token")).toBe(TOKEN);
    expect(formData.get("password")).toBe(TYPED);
  });

  test("a password error shows under the field, focuses it and doesn't echo the password", async () => {
    await submitWith({
      fieldErrors: { password: [resetPassword.passwordTooShort] },
    });
    expect(
      await screen.findByText(resetPassword.passwordTooShort),
    ).toBeInTheDocument();
    expect(passwordField()).toHaveAttribute("aria-invalid", "true");
    await vi.waitFor(() => expect(passwordField()).toHaveFocus());
    expect(passwordField()).toHaveValue("");
  });

  test("an unexpected failure focuses the notice, not an alert", async () => {
    await submitWith({ formError: "unexpected" });
    const notice = await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(notice.closest("[tabindex='-1']")).toHaveFocus(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("a broken link swaps in the broken-link state and focuses its heading", async () => {
    await submitWith({ linkBroken: true });
    const heading = await screen.findByRole("heading", {
      level: 1,
      name: linkBroken.heading,
    });
    await vi.waitFor(() => expect(heading).toHaveFocus());
    expect(screen.queryByLabelText(resetPassword.passwordLabel)).toBeNull();
    expect(
      screen.getByRole("link", { name: linkBroken.action }),
    ).toHaveAttribute("href", "/login");
  });
});
