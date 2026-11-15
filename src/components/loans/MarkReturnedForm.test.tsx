import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { markLoanReturned } from "@/actions/loans";
import { LOAN_HEADING_ID } from "@/components/loans/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { errors } from "@/strings/errors";
import { loanActions } from "@/strings/loanActions";
import type { MarkReturnedState } from "@/types/loan";
import MarkReturnedForm from "./MarkReturnedForm";

vi.mock("@/actions/loans", () => ({
  markLoanOut: vi.fn(),
  markLoanReturned: vi.fn(),
}));

const TITLE = "Cordless drill";
const MIN = "2030-06-10";
const MAX = "2030-06-15";
let markBack: () => void = () => {};

// Stands in for the loan page: the re-render after a return drops the form.
function Page() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    markBack = () => setOpen(false);
  }, []);
  return (
    <>
      <h1 id={LOAN_HEADING_ID} tabIndex={-1}>
        {TITLE}
      </h1>
      {open && <MarkReturnedForm loanId="loan-1" minDate={MIN} maxDate={MAX} />}
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const submit = () => screen.getByRole("button", { name: loanActions.markBack });
const dateInput = () => screen.getByLabelText(loanActions.backOn);
const radio = (name: string) => screen.getByRole("radio", { name });

// A browser drops focus when the pending button is disabled; jsdom doesn't.
function refuseWith(state: MarkReturnedState) {
  vi.mocked(markLoanReturned).mockImplementation(async () => {
    (document.activeElement as HTMLElement).blur();
    return state;
  });
}

describe("MarkReturnedForm", () => {
  test("the date's bounds and default come from props; no answer is pre-checked", () => {
    render(<Page />);

    expect(dateInput()).toHaveAttribute("type", "date");
    expect(dateInput()).toHaveAttribute("min", MIN);
    expect(dateInput()).toHaveAttribute("max", MAX);
    expect(dateInput()).toHaveValue(MAX);
    expect(radio(loanActions.asLentYes)).not.toBeChecked();
    expect(radio(loanActions.asLentNo)).not.toBeChecked();
    expect(radio(loanActions.asLentYes)).not.toBeRequired();
    expect(
      screen.getByRole("radiogroup", { name: loanActions.asLentLegend }),
    ).not.toHaveAttribute("aria-invalid");
  });

  test("submits the id, the date and the answer", async () => {
    vi.mocked(markLoanReturned).mockResolvedValue({ formError: "unexpected" });
    render(<Page />);

    await userEvent.click(radio(loanActions.asLentNo));
    await userEvent.click(submit());

    const sent = vi.mocked(markLoanReturned).mock.calls[0][1];
    expect(sent.get("id")).toBe("loan-1");
    expect(sent.get("returnedOn")).toBe(MAX);
    expect(sent.get("asLent")).toBe("no");
  });

  test("a date error focuses the date input and keeps the echoed values", async () => {
    refuseWith({
      fieldErrors: { returnedOn: [loanActions.returnedOnBeforeStart] },
      values: { returnedOn: "2030-06-12", asLent: "yes" },
    });
    render(<Page />);
    await userEvent.click(submit());

    await screen.findByText(loanActions.returnedOnBeforeStart);
    await vi.waitFor(() => expect(dateInput()).toHaveFocus());
    expect(dateInput()).toHaveAttribute("aria-invalid", "true");
    expect(dateInput()).toHaveValue("2030-06-12");
    expect(radio(loanActions.asLentYes)).toBeChecked();
  });

  test("a missing answer focuses the first radio; the group is invalid and describes the error", async () => {
    refuseWith({
      fieldErrors: { asLent: [loanActions.asLentRequired] },
      values: { returnedOn: "2030-06-14", asLent: "" },
    });
    render(<Page />);
    await userEvent.click(submit());

    await screen.findByText(loanActions.asLentRequired);
    await vi.waitFor(() => expect(radio(loanActions.asLentYes)).toHaveFocus());
    const group = screen.getByRole("radiogroup", {
      name: loanActions.asLentLegend,
    });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription(loanActions.asLentRequired);
    expect(dateInput()).toHaveValue("2030-06-14");
  });

  test("an echoed answer replaces the one checked before the submit", async () => {
    refuseWith({
      fieldErrors: { returnedOn: [loanActions.returnedOnAfterToday] },
      values: { returnedOn: "2030-06-16", asLent: "no" },
    });
    render(<Page />);
    await userEvent.click(radio(loanActions.asLentYes));
    await userEvent.click(submit());

    await screen.findByText(loanActions.returnedOnAfterToday);
    expect(radio(loanActions.asLentNo)).toBeChecked();
    expect(radio(loanActions.asLentYes)).not.toBeChecked();
  });

  test("an unexpected failure focuses its notice and keeps the form", async () => {
    refuseWith({
      formError: "unexpected",
      values: { returnedOn: "2030-06-13", asLent: "no" },
    });
    render(<Page />);
    await userEvent.click(submit());

    await screen.findByText(errors.actionFailed);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.actionFailed),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(submit()).toBeInTheDocument();
    expect(dateInput()).toHaveValue("2030-06-13");
    expect(radio(loanActions.asLentNo)).toBeChecked();
  });

  test("a stale screen shows only its focused notice", async () => {
    refuseWith({ formError: "stale" });
    render(<Page />);
    await userEvent.click(submit());

    await screen.findByText(errors.stale);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.stale),
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("success toasts and focuses the heading as the form unmounts", async () => {
    vi.mocked(markLoanReturned).mockImplementation(async () => {
      markBack();
      return { flash: "loanReturned" };
    });
    render(<Page />);
    await userEvent.click(radio(loanActions.asLentYes));
    await userEvent.click(submit());

    await vi.waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(getActiveToast()?.key).toBe("loanReturned");
    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { name: TITLE })).toHaveFocus(),
    );
  });
});
