import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { requestLoan } from "@/actions/loans";
import { REQUEST_LIMITS } from "@/lib/loans/limits";
import { LOAN_MESSAGE_MAX } from "@/lib/schemas/loans";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { requestForm } from "@/strings/requestForm";
import type { RequestLoanState } from "@/types/loan";
import RequestLoanForm from "./RequestLoanForm";

vi.mock("@/actions/loans", () => ({ requestLoan: vi.fn() }));

const PROPS = {
  itemId: "item-1",
  ownerName: "Olga M.",
  maxLoanDays: 7,
  minStart: "2030-06-15",
  maxStart: "2030-08-14",
};

const from = () => screen.getByLabelText(requestForm.from);
const to = () => screen.getByLabelText(requestForm.to);
const message = () =>
  screen.getByLabelText(t(requestForm.message, { owner: "Olga M." }));

const pick = (input: HTMLElement, value: string) =>
  fireEvent.change(input, { target: { value } });

const lengthLine = (days: string, limit = requestForm.lengthLimitOther) =>
  t(requestForm.lengthLine, {
    length: days,
    limit: t(limit, { owner: "Olga M.", max: PROPS.maxLoanDays }),
  });

async function submit(state: RequestLoanState) {
  vi.mocked(requestLoan).mockResolvedValue(state);
  const view = render(<RequestLoanForm {...PROPS} />);
  await userEvent.click(screen.getByRole("button", { name: requestForm.send }));
  return view;
}

describe("RequestLoanForm", () => {
  test("the date bounds come from the props; To follows the chosen start", () => {
    const { container } = render(<RequestLoanForm {...PROPS} />);

    expect(from()).toHaveAttribute("type", "date");
    expect(from()).toHaveAttribute("min", "2030-06-15");
    expect(from()).toHaveAttribute("max", "2030-08-14");
    expect(to()).toHaveAttribute("min", "2030-06-15");
    pick(from(), "2030-06-20");
    expect(to()).toHaveAttribute("min", "2030-06-20");
    expect(message()).toHaveAttribute("maxLength", String(LOAN_MESSAGE_MAX));
    expect(
      container.querySelector('input[type="hidden"][name="itemId"]'),
    ).toHaveValue("item-1");
  });

  test("the length line appears for valid dates, updates and reads singular for one day", () => {
    render(<RequestLoanForm {...PROPS} />);
    expect(screen.queryByText(/lends this for up to/)).toBeNull();

    pick(from(), "2030-06-20");
    pick(to(), "2030-06-22");
    const line = screen.getByText(
      lengthLine(t(requestForm.lengthOther, { days: 3 })),
    );
    expect(to().getAttribute("aria-describedby")).toContain(line.id);

    pick(to(), "2030-06-20");
    expect(
      screen.getByText(lengthLine(requestForm.lengthOne)),
    ).toBeInTheDocument();
  });

  test("the length line is hidden while To is before From", () => {
    render(<RequestLoanForm {...PROPS} />);
    pick(from(), "2030-06-20");
    pick(to(), "2030-06-19");

    expect(screen.queryByText(/lends this for up to/)).toBeNull();
    expect(to()).not.toHaveAttribute("aria-describedby");
  });

  test("an item lent for one day says so", () => {
    render(<RequestLoanForm {...PROPS} maxLoanDays={1} />);
    pick(from(), "2030-06-20");
    pick(to(), "2030-06-20");

    expect(
      screen.getByText(
        t(requestForm.lengthLine, {
          length: requestForm.lengthOne,
          limit: t(requestForm.lengthLimitOne, { owner: "Olga M." }),
        }),
      ),
    ).toBeInTheDocument();
  });

  test("a form error focuses the notice, which isn't an alert", async () => {
    await submit({ formError: "datesTaken" });

    const text = await screen.findByText(requestForm.datesTaken);
    const notice = text.closest('[tabindex="-1"]');
    await vi.waitFor(() => expect(notice).toHaveFocus());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test.each([
    ["stale", requestForm.stale],
    ["itemLimit", requestForm.itemLimit],
    [
      "overallLimit",
      t(requestForm.overallLimit, { limit: REQUEST_LIMITS.overall }),
    ],
    ["unexpected", errors.actionFailed],
  ] as const)("formError %s reads its sentence", async (formError, text) => {
    await submit({ formError });
    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  test("needsContactDetails links to the account page", async () => {
    await submit({ formError: "needsContactDetails" });

    expect(
      await screen.findByRole("link", { name: requestForm.accountLink }),
    ).toHaveAttribute("href", "/account");
  });

  test("a field error focuses the first invalid field; the echoed values stay", async () => {
    await submit({
      fieldErrors: { endDate: [requestForm.endBeforeStart] },
      values: {
        startDate: "2030-06-22",
        endDate: "2030-06-20",
        message: "Saturday?",
      },
    });

    expect(
      await screen.findByText(requestForm.endBeforeStart),
    ).toBeInTheDocument();
    await vi.waitFor(() => expect(to()).toHaveFocus());
    expect(to()).toHaveAttribute("aria-invalid", "true");
    expect(from()).toHaveValue("2030-06-22");
    expect(to()).toHaveValue("2030-06-20");
    expect(message()).toHaveValue("Saturday?");
  });

  // Nothing typed: the inputs can only hold what the action echoed.
  test("after datesTaken the echoed dates and message come back to retry", async () => {
    await submit({
      formError: "datesTaken",
      values: {
        startDate: "2030-06-25",
        endDate: "2030-06-27",
        message: "Sunday instead?",
      },
    });

    expect(await screen.findByText(requestForm.datesTaken)).toBeInTheDocument();
    expect(from()).toHaveValue("2030-06-25");
    expect(to()).toHaveValue("2030-06-27");
    expect(message()).toHaveValue("Sunday instead?");
  });
});
