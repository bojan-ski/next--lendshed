import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deleteOwnAccount } from "@/actions/account";
import { account } from "@/strings/account";
import { errors } from "@/strings/errors";
import DeleteAccountButton from "./DeleteAccountButton";

vi.mock("@/actions/account", () => ({
  updateProfile: vi.fn(),
  updateContactDetails: vi.fn(),
  changePassword: vi.fn(),
  deleteOwnAccount: vi.fn(),
}));

const toggle = () =>
  screen.getByRole("button", { name: account.deleteAccount });
const confirmButton = () =>
  screen.getByRole("button", { name: account.deleteConfirmButton });

const CONSEQUENCES = [
  account.deleteSignOut,
  account.deleteLoans,
  account.deleteItems,
  account.deletePhotos,
  account.deleteHistory,
  account.deleteFinal,
];

async function startConfirm(isOrganizer = false) {
  render(<DeleteAccountButton isOrganizer={isOrganizer} />);
  await userEvent.click(toggle());
}

// Success redirects to /login (the action test covers it); here, the steps
// and the refusals.
describe("DeleteAccountButton", () => {
  test("Delete account asks first, lists what happens and focuses the confirm button", async () => {
    await startConfirm();

    expect(screen.getByText(account.deleteConfirm)).toBeVisible();
    for (const line of CONSEQUENCES) {
      expect(screen.getByText(line)).toBeVisible();
    }
    expect(screen.queryByText(account.deleteInvitations)).toBeNull();
    await vi.waitFor(() => expect(confirmButton()).toHaveFocus());
    expect(confirmButton()).toHaveAccessibleDescription(
      expect.stringContaining(account.deleteConfirm),
    );
    expect(confirmButton()).toHaveAccessibleDescription(
      expect.stringContaining(account.deleteFinal),
    );
    expect(deleteOwnAccount).not.toHaveBeenCalled();
  });

  test("an organizer is also told their open invitations stop working", async () => {
    await startConfirm(true);
    expect(screen.getByText(account.deleteInvitations)).toBeVisible();
  });

  test("Keep my account closes the step without deleting and focuses the toggle", async () => {
    await startConfirm();

    await userEvent.click(
      screen.getByRole("button", { name: account.keepAccount }),
    );

    await vi.waitFor(() => expect(toggle()).toHaveFocus());
    expect(screen.queryByText(account.deleteSignOut)).toBeNull();
    expect(deleteOwnAccount).not.toHaveBeenCalled();
  });

  test("confirming sends confirm=true and nothing else", async () => {
    vi.mocked(deleteOwnAccount).mockResolvedValue({ formError: "stale" });
    await startConfirm();

    await userEvent.click(confirmButton());

    const sent = vi.mocked(deleteOwnAccount).mock.calls[0][1];
    expect([...sent.keys()]).toEqual(["confirm"]);
    expect(sent.get("confirm")).toBe("true");
  });

  test.each([
    ["stale", errors.stale],
    ["itemOut", account.deleteBlockedItemOut],
    ["holdingItem", account.deleteBlockedHolding],
    ["lastOrganizer", account.deleteBlockedLastOrganizer],
  ] as const)(
    "a %s refusal replaces the control with its focused notice",
    async (formError, text) => {
      vi.mocked(deleteOwnAccount).mockResolvedValue({ formError });
      await startConfirm();

      await userEvent.click(confirmButton());

      const notice = await screen.findByText(text);
      await vi.waitFor(() =>
        expect(notice.closest("[tabindex='-1']")).toHaveFocus(),
      );
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(document.querySelector("form")).toBeNull();
    },
  );

  test("an unexpected failure keeps the confirm step, the notice above it", async () => {
    vi.mocked(deleteOwnAccount).mockResolvedValue({ formError: "unexpected" });
    await startConfirm();

    await userEvent.click(confirmButton());

    const notice = await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(notice.closest("[tabindex='-1']")).toHaveFocus(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(confirmButton()).toBeVisible();
    expect(
      notice.compareDocumentPosition(confirmButton()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
