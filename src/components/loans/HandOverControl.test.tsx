import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { markLoanOut } from "@/actions/loans";
import { LOAN_HEADING_ID } from "@/components/loans/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { errors } from "@/strings/errors";
import { loanActions } from "@/strings/loanActions";
import HandOverControl from "./HandOverControl";

vi.mock("@/actions/loans", () => ({
  markLoanOut: vi.fn(),
  markLoanReturned: vi.fn(),
}));

const TITLE = "Cordless drill";
let handOver: () => void = () => {};

// Stands in for the loan page: the re-render after a handover drops the control.
function Page() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    handOver = () => setOpen(false);
  }, []);
  return (
    <>
      <h1 id={LOAN_HEADING_ID} tabIndex={-1}>
        {TITLE}
      </h1>
      {open && <HandOverControl loanId="loan-1" />}
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const button = () => screen.getByRole("button", { name: loanActions.handOver });

describe("HandOverControl", () => {
  test("Handed over submits the id at once, with no confirmation step", async () => {
    vi.mocked(markLoanOut).mockResolvedValue({ formError: "unexpected" });
    render(<Page />);

    await userEvent.click(button());

    expect(vi.mocked(markLoanOut).mock.calls[0][1].get("id")).toBe("loan-1");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  test("success toasts and focuses the heading as the control unmounts", async () => {
    vi.mocked(markLoanOut).mockImplementation(async () => {
      handOver();
      return { flash: "loanHandedOver" };
    });
    render(<Page />);

    await userEvent.click(button());

    await vi.waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(getActiveToast()?.key).toBe("loanHandedOver");
    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { name: TITLE })).toHaveFocus(),
    );
  });

  test.each([
    ["stale", errors.stale],
    ["stillOut", loanActions.notBack],
  ] as const)("%s shows only its focused notice", async (formError, text) => {
    vi.mocked(markLoanOut).mockResolvedValue({ formError });
    render(<Page />);
    await userEvent.click(button());

    await screen.findByText(text);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(text),
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(getActiveToast()).toBeNull();
  });

  test("an unexpected failure keeps the button to try again", async () => {
    vi.mocked(markLoanOut).mockResolvedValue({ formError: "unexpected" });
    render(<Page />);
    await userEvent.click(button());

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(button()).toBeInTheDocument();
  });
});
