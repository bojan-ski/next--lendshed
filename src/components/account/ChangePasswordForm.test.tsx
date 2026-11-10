import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { changePassword } from "@/actions/account";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import type { ChangePasswordState } from "@/types/account";
import ChangePasswordForm from "./ChangePasswordForm";

vi.mock("@/actions/account", () => ({
  updateProfile: vi.fn(),
  updateContactDetails: vi.fn(),
  changePassword: vi.fn(),
}));

afterEach(() => {
  act(() => dismissToast());
});

const current = () => screen.getByLabelText(account.currentPasswordLabel);
const next = () => screen.getByLabelText(account.newPasswordLabel);

async function submitWith(state: ChangePasswordState) {
  vi.mocked(changePassword).mockResolvedValue(state);
  render(<ChangePasswordForm />);
  await userEvent.type(current(), "old-password");
  await userEvent.type(next(), "new-password-1");
  await userEvent.click(
    screen.getByRole("button", { name: account.changePassword }),
  );
}

describe("ChangePasswordForm", () => {
  test("two password fields with the right autocomplete and the new-password hint", () => {
    render(<ChangePasswordForm />);
    expect(current()).toHaveAttribute("type", "password");
    expect(current()).toHaveAttribute("autocomplete", "current-password");
    expect(next()).toHaveAttribute("type", "password");
    expect(next()).toHaveAttribute("autocomplete", "new-password");
    expect(next()).toHaveAccessibleDescription(account.newPasswordHint);
    expect(current()).toBeRequired();
    expect(next()).toBeRequired();
  });

  test("a wrong current password focuses that field and clears both", async () => {
    await submitWith({
      fieldErrors: { currentPassword: [account.currentPasswordWrong] },
    });

    expect(
      await screen.findByText(account.currentPasswordWrong),
    ).toBeInTheDocument();
    expect(current()).toHaveFocus();
    expect(current()).toHaveValue("");
    expect(next()).toHaveValue("");
  });

  test.each([
    ["tooManyAttempts", account.tooManyAttempts],
    ["unexpected", errors.actionFailed],
  ] as const)("a %s refusal focuses its notice", async (formError, text) => {
    await submitWith({ formError });

    await screen.findByText(text);
    expect(document.activeElement).toHaveTextContent(text);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("a change toasts passwordChanged and leaves both fields empty", async () => {
    await submitWith({ flash: "passwordChanged" });

    await vi.waitFor(() =>
      expect(getActiveToast()?.key).toBe("passwordChanged"),
    );
    expect(current()).toHaveValue("");
    expect(next()).toHaveValue("");
  });

  test("sends both passwords under the schema's field names", async () => {
    await submitWith({ flash: "passwordChanged" });
    const formData = vi.mocked(changePassword).mock.calls[0][1];
    expect(formData.get("currentPassword")).toBe("old-password");
    expect(formData.get("newPassword")).toBe("new-password-1");
  });
});
