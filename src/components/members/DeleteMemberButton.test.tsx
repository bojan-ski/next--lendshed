import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deleteMember } from "@/actions/members";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { members } from "@/strings/members";
import DeleteMemberButton from "./DeleteMemberButton";

vi.mock("@/actions/members", () => ({
  promoteMember: vi.fn(),
  demoteMember: vi.fn(),
  createResetLink: vi.fn(),
  suspendMember: vi.fn(),
  reinstateMember: vi.fn(),
  deleteMember: vi.fn(),
}));

const NAME = "Mira K.";

const toggle = () =>
  screen.getByRole("button", {
    name: t(members.deleteFor, { name: NAME }),
  });
const confirmButton = () =>
  screen.getByRole("button", { name: members.deleteAccount });

async function startConfirm() {
  render(<DeleteMemberButton memberId="m-1" memberName={NAME} />);
  await userEvent.click(toggle());
}

// Success redirects to Members (the action test covers it); here, the steps
// and the refusals.
describe("DeleteMemberButton", () => {
  test("the toggle names the person, starting with its visible text", () => {
    render(<DeleteMemberButton memberId="m-1" memberName={NAME} />);
    expect(toggle()).toHaveTextContent(members.deleteAccount);
  });

  test("Delete account asks first, naming the person, and focuses the confirm button", async () => {
    await startConfirm();

    const question = t(members.deleteConfirm, { name: NAME });
    expect(screen.getByText(question)).toBeVisible();
    for (const line of [
      members.deleteLoans,
      members.deleteItems,
      members.deletePhotos,
      members.deleteHistory,
      members.deleteFinal,
    ]) {
      expect(screen.getByText(line)).toBeVisible();
    }
    await vi.waitFor(() => expect(confirmButton()).toHaveFocus());
    expect(confirmButton()).toHaveAccessibleDescription(
      expect.stringContaining(question),
    );
    expect(deleteMember).not.toHaveBeenCalled();
  });

  test("Keep account closes the step without deleting and focuses the toggle", async () => {
    await startConfirm();

    await userEvent.click(
      screen.getByRole("button", { name: members.keepAccount }),
    );

    await vi.waitFor(() => expect(toggle()).toHaveFocus());
    expect(screen.queryByText(members.deleteLoans)).toBeNull();
    expect(deleteMember).not.toHaveBeenCalled();
  });

  test("confirming sends the member's id", async () => {
    vi.mocked(deleteMember).mockResolvedValue({ formError: "stale" });
    await startConfirm();

    await userEvent.click(confirmButton());

    expect(vi.mocked(deleteMember).mock.calls[0][1].get("id")).toBe("m-1");
  });

  test.each([
    ["stale", errors.stale],
    ["itemOut", members.deleteItemOut],
    ["holdingItem", members.deleteHolding],
    ["self", members.deleteSelf],
  ] as const)(
    "a %s refusal replaces the control with its focused notice",
    async (formError, text) => {
      vi.mocked(deleteMember).mockResolvedValue({ formError });
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
    vi.mocked(deleteMember).mockResolvedValue({ formError: "unexpected" });
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
