import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { updateContactDetails } from "@/actions/account";
import { CONTACT_LOCKED_ID } from "@/components/account/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import type { ContactDetailsFormState } from "@/types/account";
import ContactDetailsForm from "./ContactDetailsForm";

vi.mock("@/actions/account", () => ({
  updateProfile: vi.fn(),
  updateContactDetails: vi.fn(),
  changePassword: vi.fn(),
}));

const SAVED = "Phone 555 0101\nAfter 6";

afterEach(() => {
  act(() => dismissToast());
});

const field = () => screen.getByLabelText(account.contactLabel);

async function submitWith(state: ContactDetailsFormState, typed = "x") {
  vi.mocked(updateContactDetails).mockResolvedValue(state);
  render(<ContactDetailsForm contactDetails={SAVED} locked={false} />);
  await userEvent.clear(field());
  if (typed) await userEvent.type(field(), typed);
  await userEvent.click(
    screen.getByRole("button", { name: account.saveContact }),
  );
}

describe("ContactDetailsForm", () => {
  test("a 5-row textarea with the saved details, the hint and no maxLength", () => {
    render(<ContactDetailsForm contactDetails={SAVED} locked={false} />);
    expect(field().tagName).toBe("TEXTAREA");
    expect(field()).toHaveAttribute("rows", "5");
    expect(field()).not.toHaveAttribute("maxlength");
    expect(field()).toHaveValue(SAVED);
    expect(field()).toHaveAccessibleDescription(account.contactHint);
    expect(screen.queryByText(account.contactLocked)).toBeNull();
  });

  test("no saved details render as an empty field", () => {
    render(<ContactDetailsForm contactDetails={null} locked={false} />);
    expect(field()).toHaveValue("");
  });

  test("the locked info line shows only when the details are locked", () => {
    render(<ContactDetailsForm contactDetails={SAVED} locked />);
    expect(screen.getByText(account.contactLocked)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("the locked line describes the field after the hint", () => {
    render(<ContactDetailsForm contactDetails={SAVED} locked />);
    const ids = field().getAttribute("aria-describedby")?.split(" ");
    expect(ids).toEqual(["contactDetails-hint", CONTACT_LOCKED_ID]);
    expect(field()).toHaveAccessibleDescription(
      `${account.contactHint} ${account.contactLocked}`,
    );
  });

  test("a refused clear replaces the info line: the sentence shows and describes once", async () => {
    vi.mocked(updateContactDetails).mockResolvedValue({
      formError: "contactDetailsLocked",
    });
    render(<ContactDetailsForm contactDetails={SAVED} locked />);
    await userEvent.clear(field());
    await userEvent.click(
      screen.getByRole("button", { name: account.saveContact }),
    );

    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(account.contactLocked),
    );
    expect(screen.getAllByText(account.contactLocked)).toHaveLength(1);
    expect(document.activeElement).toHaveAttribute("id", CONTACT_LOCKED_ID);
    expect(field()).toHaveAccessibleDescription(
      `${account.contactHint} ${account.contactLocked}`,
    );
  });

  test("an unlocked field names no locked line", () => {
    render(<ContactDetailsForm contactDetails={SAVED} locked={false} />);
    expect(field().getAttribute("aria-describedby")).toBe(
      "contactDetails-hint",
    );
    expect(document.getElementById(CONTACT_LOCKED_ID)).toBeNull();
  });

  test("a field error echoes the text and focuses the field", async () => {
    await submitWith({
      fieldErrors: { contactDetails: [account.contactTooLong] },
      contactDetails: "too long",
    });

    expect(await screen.findByText(account.contactTooLong)).toBeInTheDocument();
    expect(field()).toHaveValue("too long");
    expect(field()).toHaveFocus();
  });

  test("a locked clear focuses the notice and shows the saved details again", async () => {
    await submitWith({ formError: "contactDetailsLocked" }, "");

    await screen.findByText(account.contactLocked);
    expect(document.activeElement).toHaveTextContent(account.contactLocked);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field()).toHaveValue(SAVED);
    expect(getActiveToast()).toBeNull();
  });

  test("an unexpected failure focuses the notice and keeps the typed text", async () => {
    await submitWith({ formError: "unexpected", contactDetails: "typed" });

    await screen.findByText(errors.actionFailed);
    expect(document.activeElement).toHaveTextContent(errors.actionFailed);
    expect(field()).toHaveValue("typed");
  });

  test("a save toasts contactDetailsSaved", async () => {
    await submitWith({ flash: "contactDetailsSaved" });
    await vi.waitFor(() =>
      expect(getActiveToast()?.key).toBe("contactDetailsSaved"),
    );
  });
});
