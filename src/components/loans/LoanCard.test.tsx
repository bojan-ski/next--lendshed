import { render, screen } from "@testing-library/react";
import { strings } from "@/strings";
import type { LoanCardDTO } from "@/types/loan";
import LoanCard from "./LoanCard";

const loan: LoanCardDTO = {
  id: "loan-1",
  side: "borrowing",
  item: { id: "item-1", title: "Step ladder", photo: null },
  otherPartyName: "Ruth K.",
  startDate: "2026-11-12",
  endDate: "2026-11-14",
  status: "approved",
  group: "active",
  needsYou: null,
  changed: false,
};

// The visible label first, then the item title for screen readers (WCAG 2.4.4, 2.5.3).
const openLoan = () =>
  screen.getByRole("link", {
    name: `${strings.loanCard.openLoan} ${loan.item.title}`,
  });
const accentButtons = (container: HTMLElement) =>
  container.querySelectorAll("a.bg-accent, button.bg-accent");

describe("LoanCard", () => {
  test("party line uses the side's phrasing and the preformatted date range", () => {
    const { rerender } = render(
      <LoanCard loan={loan} dateRange="Thu 12 – Sat 14 Nov" nextStep={null} />,
    );
    expect(
      screen.getByText("from Ruth K. · Thu 12 – Sat 14 Nov"),
    ).toBeInTheDocument();
    rerender(
      <LoanCard
        loan={{ ...loan, side: "lending" }}
        dateRange="Thu 12 – Sat 14 Nov"
        nextStep={null}
      />,
    );
    expect(
      screen.getByText("to Ruth K. · Thu 12 – Sat 14 Nov"),
    ).toBeInTheDocument();
  });

  test("shows the status label for the effective status", () => {
    render(
      <LoanCard
        loan={{ ...loan, status: "overdue" }}
        dateRange="x"
        nextStep={null}
      />,
    );
    expect(screen.getByText(strings.status.loan.overdue)).toBeInTheDocument();
  });

  test("change dot with screen-reader text only when changed", () => {
    const { rerender } = render(
      <LoanCard loan={loan} dateRange="x" nextStep={null} />,
    );
    expect(
      screen.queryByText(strings.loanCard.changed),
    ).not.toBeInTheDocument();
    rerender(
      <LoanCard
        loan={{ ...loan, changed: true }}
        dateRange="x"
        nextStep={null}
      />,
    );
    expect(screen.getByText(strings.loanCard.changed)).toBeInTheDocument();
  });

  test("next step line only when not null", () => {
    const { rerender } = render(
      <LoanCard loan={loan} dateRange="x" nextStep={null} />,
    );
    expect(
      screen.queryByText("Arrange pickup with Ruth."),
    ).not.toBeInTheDocument();
    rerender(
      <LoanCard
        loan={loan}
        dateRange="x"
        nextStep="Arrange pickup with Ruth."
      />,
    );
    expect(screen.getByText("Arrange pickup with Ruth.")).toBeInTheDocument();
  });

  test("Open loan links to the loan and is outline when nothing needs you", () => {
    const { container } = render(
      <LoanCard loan={loan} dateRange="x" nextStep={null} />,
    );
    expect(openLoan()).toHaveAttribute("href", "/loans/loan-1");
    expect(accentButtons(container)).toHaveLength(0);
  });

  test("Open loan is the one accent button when the loan needs you", () => {
    const { container } = render(
      <LoanCard
        loan={{ ...loan, needsYou: "arrange_pickup" }}
        dateRange="x"
        nextStep={null}
      />,
    );
    expect(accentButtons(container)).toHaveLength(1);
    expect(accentButtons(container)[0]).toBe(openLoan());
  });
});
