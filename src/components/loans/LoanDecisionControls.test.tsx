import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { approveLoan, declineLoan } from "@/actions/loans";
import { LOAN_HEADING_ID } from "@/components/loans/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { LOAN_REASON_MAX } from "@/lib/schemas/loans";
import { errors } from "@/strings/errors";
import { loanActions } from "@/strings/loanActions";
import { requestForm } from "@/strings/requestForm";
import LoanDecisionControls from "./LoanDecisionControls";

vi.mock("@/actions/loans", () => ({
  requestLoan: vi.fn(),
  approveLoan: vi.fn(),
  declineLoan: vi.fn(),
  cancelLoan: vi.fn(),
}));

const TITLE = "Cordless drill";
let decide: () => void = () => {};

// Stands in for the loan page: the re-render after a decision drops the card.
function Page({ canApprove = true }: { canApprove?: boolean }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    decide = () => setOpen(false);
  }, []);
  return (
    <>
      <h1 id={LOAN_HEADING_ID} tabIndex={-1}>
        {TITLE}
      </h1>
      {open && <LoanDecisionControls loanId="loan-1" canApprove={canApprove} />}
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const button = (name: string) => screen.getByRole("button", { name });
const reasonBox = () =>
  screen.getByRole("textbox", { name: loanActions.reasonLabel });

async function startDecline() {
  render(<Page />);
  await userEvent.click(button(loanActions.decline));
}

describe("LoanDecisionControls", () => {
  test("Approve submits the id at once, with no confirmation step", async () => {
    vi.mocked(approveLoan).mockResolvedValue({ formError: "unexpected" });
    render(<Page />);

    await userEvent.click(button(loanActions.approve));

    expect(vi.mocked(approveLoan).mock.calls[0][1].get("id")).toBe("loan-1");
    expect(screen.queryByText(loanActions.declineQuestion)).toBeNull();
  });

  test("without canApprove only Decline is offered", () => {
    render(<Page canApprove={false} />);
    expect(
      screen.queryByRole("button", { name: loanActions.approve }),
    ).toBeNull();
    expect(button(loanActions.decline)).toBeInTheDocument();
  });

  test("Decline asks first and focuses its confirm button", async () => {
    await startDecline();

    expect(screen.getByText(loanActions.declineQuestion)).toBeInTheDocument();
    const confirm = button(loanActions.declineConfirm);
    await vi.waitFor(() => expect(confirm).toHaveFocus());
    expect(confirm).toHaveAccessibleDescription(loanActions.declineQuestion);
    expect(reasonBox()).toHaveAttribute("maxLength", String(LOAN_REASON_MAX));
    expect(reasonBox()).toHaveAccessibleDescription(
      loanActions.reasonHintBorrower,
    );
    expect(declineLoan).not.toHaveBeenCalled();
  });

  test("Keep it goes back without declining and focuses Decline", async () => {
    await startDecline();
    await userEvent.click(button(loanActions.keep));

    await vi.waitFor(() => expect(button(loanActions.decline)).toHaveFocus());
    expect(declineLoan).not.toHaveBeenCalled();
  });

  test("confirming sends the id and the reason", async () => {
    vi.mocked(declineLoan).mockResolvedValue({ formError: "unexpected" });
    await startDecline();
    await userEvent.type(reasonBox(), "Away that week");
    await userEvent.click(button(loanActions.declineConfirm));

    const sent = vi.mocked(declineLoan).mock.calls[0][1];
    expect(sent.get("id")).toBe("loan-1");
    expect(sent.get("reason")).toBe("Away that week");
  });

  test.each([
    ["approve", loanActions.approve, approveLoan, "loanApproved"],
    ["decline", loanActions.declineConfirm, declineLoan, "loanDeclined"],
  ] as const)(
    "a successful %s toasts and focuses the heading as the card unmounts",
    async (kind, label, action, flash) => {
      vi.mocked(action).mockImplementation(async () => {
        decide();
        return { flash };
      });
      if (kind === "decline") await startDecline();
      else render(<Page />);

      await userEvent.click(button(label));

      await vi.waitFor(() => expect(screen.queryByRole("button")).toBeNull());
      expect(getActiveToast()?.key).toBe(flash);
      await vi.waitFor(() =>
        expect(screen.getByRole("heading", { name: TITLE })).toHaveFocus(),
      );
    },
  );

  test.each([
    ["stale", errors.stale],
    ["datesTaken", requestForm.datesTaken],
  ] as const)(
    "approve %s shows only its focused notice",
    async (formError, text) => {
      vi.mocked(approveLoan).mockResolvedValue({ formError });
      render(<Page />);
      await userEvent.click(button(loanActions.approve));

      await screen.findByText(text);
      await vi.waitFor(() =>
        expect(document.activeElement).toHaveTextContent(text),
      );
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
      expect(getActiveToast()).toBeNull();
    },
  );

  test("a stale decline shows only its focused notice", async () => {
    vi.mocked(declineLoan).mockResolvedValue({ formError: "stale" });
    await startDecline();
    await userEvent.click(button(loanActions.declineConfirm));

    await screen.findByText(errors.stale);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.stale),
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("an unexpected approve keeps both buttons to try again", async () => {
    vi.mocked(approveLoan).mockResolvedValue({ formError: "unexpected" });
    render(<Page />);
    await userEvent.click(button(loanActions.approve));

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(button(loanActions.approve)).toBeInTheDocument();
    expect(button(loanActions.decline)).toBeInTheDocument();
  });

  test("an unexpected decline keeps the confirmation step and the reason", async () => {
    vi.mocked(declineLoan).mockResolvedValue({
      formError: "unexpected",
      values: { reason: "Away" },
    });
    await startDecline();
    await userEvent.type(reasonBox(), "Away");
    await userEvent.click(button(loanActions.declineConfirm));

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(button(loanActions.declineConfirm)).toBeInTheDocument();
    expect(reasonBox()).toHaveValue("Away");
  });

  test("a reason error focuses the textarea and keeps what was typed", async () => {
    const message = "Too long";
    vi.mocked(declineLoan).mockImplementation(async () => {
      // A browser drops focus when the pending button is disabled.
      (document.activeElement as HTMLElement).blur();
      return {
        fieldErrors: { reason: [message] },
        values: { reason: "Typed" },
      };
    });
    await startDecline();
    await userEvent.type(reasonBox(), "Typed");
    await userEvent.click(button(loanActions.declineConfirm));

    await screen.findByText(message);
    await vi.waitFor(() => expect(reasonBox()).toHaveFocus());
    expect(reasonBox()).toHaveValue("Typed");
    expect(reasonBox()).toHaveAttribute("aria-invalid", "true");
  });
});
