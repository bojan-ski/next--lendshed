import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { revokeInvitation } from "@/actions/invitations";
import { OPEN_INVITATIONS_HEADING_ID } from "@/components/invitations/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { invitations } from "@/strings/invitations";
import RevokeInvitationButton from "./RevokeInvitationButton";

vi.mock("@/actions/invitations", () => ({
  joinWithInvitation: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

let removeRow: () => void = () => {};

const LABEL = t(invitations.revokeFor, { note: "Mira, no. 14" });

// Stands in for the page: the refresh that follows a revoke drops the row.
function Page() {
  const [showRow, setShowRow] = useState(true);
  useEffect(() => {
    removeRow = () => setShowRow(false);
  }, []);
  return (
    <>
      <h2 id={OPEN_INVITATIONS_HEADING_ID} tabIndex={-1}>
        {invitations.openHeading}
      </h2>
      {showRow && <RevokeInvitationButton id="inv-1" label={LABEL} />}
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const revokeButton = () => screen.getByRole("button", { name: LABEL });

describe("RevokeInvitationButton", () => {
  test("names its row's invitation, starting with the visible text", () => {
    render(<Page />);
    expect(revokeButton()).toHaveTextContent(invitations.revoke);
    expect(LABEL.startsWith(invitations.revoke)).toBe(true);
  });

  test("sends the invitation id", async () => {
    vi.mocked(revokeInvitation).mockResolvedValue({ formError: "stale" });
    render(<Page />);
    await userEvent.click(revokeButton());
    const formData = vi.mocked(revokeInvitation).mock.calls[0][1];
    expect(formData.get("id")).toBe("inv-1");
  });

  // The row unmounts in the same commit as the action's state, as with refresh().
  test("a revoke toasts and focuses the list heading even as its row unmounts", async () => {
    vi.mocked(revokeInvitation).mockImplementation(async () => {
      removeRow();
      return { flash: "invitationRevoked" };
    });
    render(<Page />);

    await userEvent.click(revokeButton());

    expect(
      screen.queryByRole("button", { name: LABEL }),
    ).toBeNull();
    expect(getActiveToast()?.key).toBe("invitationRevoked");
    expect(
      screen.getByRole("heading", { name: invitations.openHeading }),
    ).toHaveFocus();
  });

  test("a stale revoke replaces the button with the focused stale notice", async () => {
    vi.mocked(revokeInvitation).mockResolvedValue({ formError: "stale" });
    render(<Page />);

    await userEvent.click(revokeButton());

    await screen.findByText(errors.stale);
    expect(document.activeElement).toHaveTextContent(errors.stale);
    expect(
      screen.queryByRole("button", { name: LABEL }),
    ).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getActiveToast()).toBeNull();
  });

  test("an unexpected failure shows the notice and keeps the button to retry", async () => {
    vi.mocked(revokeInvitation).mockResolvedValue({ formError: "unexpected" });
    render(<Page />);

    await userEvent.click(revokeButton());

    await screen.findByText(errors.actionFailed);
    expect(document.activeElement).toHaveTextContent(errors.actionFailed);
    expect(revokeButton()).toBeInTheDocument();
  });
});
