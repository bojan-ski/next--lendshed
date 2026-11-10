import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { updateProfile } from "@/actions/account";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import type { ProfileFormState } from "@/types/account";
import ProfileForm from "./ProfileForm";

vi.mock("@/actions/account", () => ({
  updateProfile: vi.fn(),
  updateContactDetails: vi.fn(),
  changePassword: vi.fn(),
}));

const saved = { name: "Mira K.", area: "north end", email: "mira@example.org" };

afterEach(() => {
  act(() => dismissToast());
});

const nameField = () => screen.getByLabelText(account.nameLabel);
const areaField = () => screen.getByLabelText(account.areaLabel);

async function submitWith(state: ProfileFormState) {
  vi.mocked(updateProfile).mockResolvedValue(state);
  render(<ProfileForm {...saved} />);
  await userEvent.clear(nameField());
  await userEvent.type(nameField(), "M");
  await userEvent.click(
    screen.getByRole("button", { name: account.saveProfile }),
  );
}

describe("ProfileForm", () => {
  test("shows the saved values, the hints and the email as text", () => {
    render(<ProfileForm {...saved} />);
    expect(nameField()).toHaveValue("Mira K.");
    expect(nameField()).toHaveAttribute("autocomplete", "name");
    expect(nameField()).toBeRequired();
    expect(areaField()).not.toBeRequired();
    expect(nameField()).toHaveAccessibleDescription(account.nameHint);
    expect(areaField()).toHaveValue("north end");
    expect(areaField()).toHaveAccessibleDescription(account.areaHint);
    expect(screen.getByText(saved.email)).toBeInTheDocument();
    expect(screen.getByText(account.emailNote)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(saved.email)).toBeNull();
  });

  test("an empty area renders as an empty field", () => {
    render(<ProfileForm {...saved} area={null} />);
    expect(areaField()).toHaveValue("");
  });

  test("field errors render under their fields, echo the values and focus the first", async () => {
    await submitWith({
      fieldErrors: { name: [account.nameTooShort] },
      name: "M",
      area: "north end",
    });

    expect(await screen.findByText(account.nameTooShort)).toBeInTheDocument();
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField()).toHaveValue("M");
    expect(nameField()).toHaveFocus();
    expect(getActiveToast()).toBeNull();
  });

  test("an unexpected failure focuses the notice, which is not also an alert", async () => {
    await submitWith({ formError: "unexpected", name: "M", area: "north end" });

    await screen.findByText(errors.actionFailed);
    expect(document.activeElement).toHaveTextContent(errors.actionFailed);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(nameField()).toHaveValue("M");
  });

  test("a save toasts profileSaved", async () => {
    await submitWith({ flash: "profileSaved" });
    await vi.waitFor(() => expect(getActiveToast()?.key).toBe("profileSaved"));
    expect(screen.queryByText(errors.actionFailed)).toBeNull();
  });
});
