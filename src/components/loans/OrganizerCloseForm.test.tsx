import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState } from "react";
import { closeLoanAsOrganizer } from "@/actions/loans";
import { LOAN_HEADING_ID } from "@/components/loans/ids";
import { dismissToast, getActiveToast } from "@/lib/feedback/toast";
import { LOAN_REASON_MAX } from "@/lib/schemas/loans";
import { errors } from "@/strings/errors";
import { loanActions } from "@/strings/loanActions";
import type { OrganizerCloseState } from "@/types/loan";
import OrganizerCloseForm from "./OrganizerCloseForm";

vi.mock("@/actions/loans", () => ({
  markLoanOut: vi.fn(),
  markLoanReturned: vi.fn(),
  closeLoanAsOrganizer: vi.fn(),
}));

const TITLE = "Cordless drill";
const MIN = "2030-06-10";
const MAX = "2030-06-15";
let close: () => void = () => {};

// Stands in for the loan page: the re-render after a close drops the form.
function Page() {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    close = () => setOpen(false);
  }, []);
  return (
    <>
      <h1 id={LOAN_HEADING_ID} tabIndex={-1}>
        {TITLE}
      </h1>
      {open && (
        <OrganizerCloseForm loanId="loan-1" minDate={MIN} maxDate={MAX} />
      )}
    </>
  );
}

afterEach(() => {
  act(() => dismissToast());
});

const submit = () =>
  screen.getByRole("button", { name: loanActions.closeLoan });
const dateInput = () => screen.getByLabelText(loanActions.backOn);
const noteInput = () =>
  screen.getByRole("textbox", { name: loanActions.noteLabel });
const radio = (name: string) => screen.getByRole("radio", { name });

// A browser drops focus when the pending button is disabled; jsdom doesn't.
function refuseWith(state: OrganizerCloseState) {
  vi.mocked(closeLoanAsOrganizer).mockImplementation(async () => {
    (document.activeElement as HTMLElement).blur();
    return state;
  });
}

describe("OrganizerCloseForm", () => {
  test("three answers in order, none pre-checked; the date's bounds and default come from props", () => {
    render(<Page />);

    expect(
      screen.getAllByRole("radio").map((input) => input.getAttribute("value")),
    ).toEqual(["yes", "no", "unknown"]);
    for (const label of [
      loanActions.asLentYes,
      loanActions.asLentNo,
      loanActions.asLentUnknown,
    ]) {
      expect(radio(label)).not.toBeChecked();
      expect(radio(label)).not.toBeRequired();
    }
    expect(
      screen.getByRole("group", { name: loanActions.asLentLegend }),
    ).toBeInTheDocument();
    expect(dateInput()).toHaveAttribute("type", "date");
    expect(dateInput()).toHaveAttribute("min", MIN);
    expect(dateInput()).toHaveAttribute("max", MAX);
    expect(dateInput()).toHaveValue(MAX);
    expect(noteInput()).toHaveAttribute("maxLength", String(LOAN_REASON_MAX));
    expect(noteInput()).toHaveAccessibleDescription(loanActions.noteHint);
  });

  test("submits the id, the date, the answer and the note", async () => {
    vi.mocked(closeLoanAsOrganizer).mockResolvedValue({
      formError: "unexpected",
    });
    render(<Page />);

    await userEvent.click(radio(loanActions.asLentUnknown));
    await userEvent.type(noteInput(), "Owner unreachable");
    await userEvent.click(submit());

    const sent = vi.mocked(closeLoanAsOrganizer).mock.calls[0][1];
    expect(sent.get("id")).toBe("loan-1");
    expect(sent.get("returnedOn")).toBe(MAX);
    expect(sent.get("asLent")).toBe("unknown");
    expect(sent.get("note")).toBe("Owner unreachable");
  });

  test("a date error comes first: it focuses the date and keeps the echoed values", async () => {
    refuseWith({
      fieldErrors: {
        returnedOn: [loanActions.returnedOnBeforeStart],
        asLent: [loanActions.asLentRequiredClose],
        note: [loanActions.noteRequired],
      },
      values: { returnedOn: "2030-06-09", asLent: "", note: "" },
    });
    render(<Page />);
    await userEvent.click(submit());

    await screen.findByText(loanActions.returnedOnBeforeStart);
    await vi.waitFor(() => expect(dateInput()).toHaveFocus());
    expect(dateInput()).toHaveAttribute("aria-invalid", "true");
    expect(dateInput()).toHaveValue("2030-06-09");
  });

  test("a missing answer before a note error focuses the first radio", async () => {
    refuseWith({
      fieldErrors: {
        asLent: [loanActions.asLentRequiredClose],
        note: [loanActions.noteRequired],
      },
      values: { returnedOn: "2030-06-14", asLent: "", note: "" },
    });
    render(<Page />);
    await userEvent.click(submit());

    await screen.findByText(loanActions.asLentRequiredClose);
    await vi.waitFor(() => expect(radio(loanActions.asLentYes)).toHaveFocus());
    expect(
      screen.getByRole("group", { name: loanActions.asLentLegend }),
    ).toHaveAccessibleDescription(loanActions.asLentRequiredClose);
  });

  test("a note error alone focuses the note; the echoed answer is checked", async () => {
    refuseWith({
      fieldErrors: { note: [loanActions.noteRequired] },
      values: { returnedOn: "2030-06-14", asLent: "unknown", note: "" },
    });
    render(<Page />);
    await userEvent.click(submit());

    await screen.findByText(loanActions.noteRequired);
    await vi.waitFor(() => expect(noteInput()).toHaveFocus());
    expect(noteInput()).toHaveAttribute("aria-invalid", "true");
    expect(radio(loanActions.asLentUnknown)).toBeChecked();
    expect(dateInput()).toHaveValue("2030-06-14");
  });

  test("an unexpected failure focuses its notice and keeps the form with the values", async () => {
    refuseWith({
      formError: "unexpected",
      values: { returnedOn: "2030-06-13", asLent: "no", note: "Typed" },
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
    expect(noteInput()).toHaveValue("Typed");
  });

  test("a stale screen shows only its focused notice", async () => {
    refuseWith({ formError: "stale" });
    render(<Page />);
    await userEvent.click(submit());

    await screen.findByText(errors.stale);
    await vi.waitFor(() =>
      expect(document.activeElement).toHaveTextContent(errors.stale),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(getActiveToast()).toBeNull();
  });

  test("success toasts and focuses the heading as the form unmounts", async () => {
    vi.mocked(closeLoanAsOrganizer).mockImplementation(async () => {
      close();
      return { flash: "loanClosed" };
    });
    render(<Page />);
    await userEvent.click(radio(loanActions.asLentYes));
    await userEvent.type(noteInput(), "Closed");
    await userEvent.click(submit());

    await vi.waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    expect(getActiveToast()?.key).toBe("loanClosed");
    await vi.waitFor(() =>
      expect(screen.getByRole("heading", { name: TITLE })).toHaveFocus(),
    );
  });
});
