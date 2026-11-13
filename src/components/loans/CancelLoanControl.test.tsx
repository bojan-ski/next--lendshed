import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { cancelLoan } from "@/actions/loans";
import { LOAN_HEADING_ID } from "@/components/loans/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { LOAN_REASON_MAX } from "@/lib/schemas/loans";
import { errors } from "@/strings/errors";
import { loanActions } from "@/strings/loanActions";
import type { CancelStage } from "@/types/loan";
import CancelLoanControl from "./CancelLoanControl";

vi.mock("@/actions/loans", () => ({
  requestLoan: vi.fn(),
  approveLoan: vi.fn(),
  declineLoan: vi.fn(),
  cancelLoan: vi.fn(),
}));

const TITLE = "Cordless drill";
let decide: () => void = () => {};

function Page({ stage }: { stage: CancelStage }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    decide = () => setOpen(false);
  }, []);
  return (
    <>
      <h1 id={LOAN_HEADING_ID} tabIndex={-1}>
        {TITLE}
      </h1>
      {open && <CancelLoanControl loanId="loan-1" stage={stage} />}
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const STAGES = [
  [
    "request",
    {
      trigger: loanActions.cancelRequest,
      question: loanActions.cancelRequestQuestion,
      confirm: loanActions.cancelRequestConfirm,
    },
  ],
  [
    "loan",
    {
      trigger: loanActions.cancelLoan,
      question: loanActions.cancelLoanQuestion,
      confirm: loanActions.cancelLoanConfirm,
    },
  ],
] as const;

const reasonBox = () =>
  screen.getByRole("textbox", { name: loanActions.reasonLabel });

describe.each(STAGES)("CancelLoanControl (%s)", (stage, label) => {
  const trigger = () => screen.getByRole("button", { name: label.trigger });
  // Both stages' trigger and confirm share a label: the confirm is the submit.
  const confirm = () =>
    screen
      .getAllByRole("button", { name: label.confirm })
      .find((node) => node.getAttribute("type") === "submit")!;

  async function startCancel() {
    render(<Page stage={stage} />);
    await userEvent.click(trigger());
  }

  test("asks first and focuses its confirm button", async () => {
    await startCancel();

    expect(screen.getByText(label.question)).toBeInTheDocument();
    await vi.waitFor(() => expect(confirm()).toHaveFocus());
    expect(confirm()).toHaveAccessibleDescription(label.question);
    expect(reasonBox()).toHaveAttribute("maxLength", String(LOAN_REASON_MAX));
    expect(reasonBox()).toHaveAccessibleDescription(
      loanActions.reasonHintOther,
    );
    expect(cancelLoan).not.toHaveBeenCalled();
  });

  test("Keep it goes back without cancelling and focuses the trigger", async () => {
    await startCancel();
    await userEvent.click(
      screen.getByRole("button", { name: loanActions.keep }),
    );

    await vi.waitFor(() => expect(trigger()).toHaveFocus());
    expect(cancelLoan).not.toHaveBeenCalled();
  });

  test("confirming sends the id, the stage and the reason", async () => {
    vi.mocked(cancelLoan).mockResolvedValue({ formError: "unexpected" });
    await startCancel();
    await userEvent.type(reasonBox(), "Plans changed");
    await userEvent.click(confirm());

    const sent = vi.mocked(cancelLoan).mock.calls[0][1];
    expect(sent.get("id")).toBe("loan-1");
    expect(sent.get("stage")).toBe(stage);
    expect(sent.get("reason")).toBe("Plans changed");
  });

  test("a cancel toasts and focuses the heading as the control unmounts", async () => {
    vi.mocked(cancelLoan).mockImplementation(async () => {
      decide();
      return { flash: "loanCancelled" };
    });
    await startCancel();
    await userEvent.click(confirm());

    await vi.waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(getActiveToast()?.key).toBe("loanCancelled");
    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { name: TITLE })).toHaveFocus(),
    );
  });

  test("stale shows only its focused notice", async () => {
    vi.mocked(cancelLoan).mockResolvedValue({ formError: "stale" });
    await startCancel();
    await userEvent.click(confirm());

    await screen.findByText(errors.stale);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.stale),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("an unexpected failure keeps the confirmation step to retry", async () => {
    vi.mocked(cancelLoan).mockResolvedValue({ formError: "unexpected" });
    await startCancel();
    await userEvent.click(confirm());

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(confirm()).toBeInTheDocument();
  });

  // The echo differs from what was typed, so the box shows the server's copy.
  test("a reason error focuses the textarea and shows the echoed reason", async () => {
    vi.mocked(cancelLoan).mockImplementation(async () => {
      (document.activeElement as HTMLElement).blur();
      return {
        fieldErrors: { reason: ["Too long"] },
        values: { reason: "Typed, as echoed" },
      };
    });
    await startCancel();
    await userEvent.type(reasonBox(), "Typed");
    await userEvent.click(confirm());

    await screen.findByText("Too long");
    await vi.waitFor(() => expect(reasonBox()).toHaveFocus());
    expect(reasonBox()).toHaveValue("Typed, as echoed");
  });
});
