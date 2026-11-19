import { fireEvent, render, screen } from "@testing-library/react";
import { t } from "@/lib/text/interpolate";
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
const primaryButtons = (container: HTMLElement) =>
  container.querySelectorAll("a.bg-primary, button.bg-primary");

// The party line is split into spans, so match the paragraph's whole text.
const partyLine = (text: string) =>
  screen.getByText(
    (_, element) => element?.tagName === "P" && element.textContent === text,
  );

describe("LoanCard", () => {
  test("party line uses the side's phrasing and the preformatted date range", () => {
    const { rerender } = render(
      <LoanCard loan={loan} dateRange="Thu 12 – Sat 14 Nov" nextStep={null} />,
    );
    expect(
      partyLine(
        t(strings.loanCard.party.borrowing, {
          name: "Ruth K.",
          dateRange: "Thu 12 – Sat 14 Nov",
        }),
      ),
    ).toBeInTheDocument();
    rerender(
      <LoanCard
        loan={{ ...loan, side: "lending" }}
        dateRange="Thu 12 – Sat 14 Nov"
        nextStep={null}
      />,
    );
    expect(
      partyLine(
        t(strings.loanCard.party.lending, {
          name: "Ruth K.",
          dateRange: "Thu 12 – Sat 14 Nov",
        }),
      ),
    ).toBeInTheDocument();
  });

  // 360 px (17a ui-reviewer): a long name truncates, the dates are never cut.
  test("only the name part can truncate; the date range never does", () => {
    render(
      <LoanCard loan={loan} dateRange="Thu 12 – Sat 14 Nov" nextStep={null} />,
    );
    const dates = screen.getByText("Thu 12 – Sat 14 Nov");
    expect(dates).toHaveClass("whitespace-nowrap");
    expect(dates).not.toHaveClass("truncate");
    expect(dates.parentElement).not.toHaveClass("truncate");
    expect(screen.getByText(/Ruth K\./)).toHaveClass("truncate");
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
    expect(primaryButtons(container)).toHaveLength(0);
  });

  test("a photo renders as a decorative 72 px thumb", () => {
    const { container } = render(
      <LoanCard
        loan={{
          ...loan,
          item: {
            ...loan.item,
            photo: { url: "/uploads/items/a.webp", width: 1200, height: 900 },
          },
        }}
        dateRange="x"
        nextStep={null}
      />,
    );
    const image = container.querySelector("img");
    expect(image).toHaveAttribute("alt", "");
    expect(image).toHaveClass("size-18", "object-cover");
    expect(screen.queryByTestId("photo-placeholder")).not.toBeInTheDocument();
  });

  test("no photo, or a failed load, shows the placeholder", () => {
    const withPhoto: LoanCardDTO = {
      ...loan,
      item: {
        ...loan.item,
        photo: { url: "/uploads/items/a.webp", width: 1200, height: 900 },
      },
    };
    const { container, rerender } = render(
      <LoanCard loan={loan} dateRange="x" nextStep={null} />,
    );
    expect(screen.getByTestId("photo-placeholder")).toHaveClass("size-18");

    rerender(<LoanCard loan={withPhoto} dateRange="x" nextStep={null} />);
    fireEvent.error(container.querySelector("img")!);

    expect(screen.getByTestId("photo-placeholder")).toBeInTheDocument();
  });

  test("the title is an h2 by default and an h3 when asked", () => {
    const { rerender } = render(
      <LoanCard loan={loan} dateRange="x" nextStep={null} />,
    );
    expect(
      screen.getByRole("heading", { level: 2, name: loan.item.title }),
    ).toBeInTheDocument();
    rerender(
      <LoanCard loan={loan} dateRange="x" nextStep={null} headingLevel="h3" />,
    );
    expect(
      screen.getByRole("heading", { level: 3, name: loan.item.title }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  test("Open loan is the one primary button when the loan needs you", () => {
    const { container } = render(
      <LoanCard
        loan={{ ...loan, needsYou: "arrange_pickup" }}
        dateRange="x"
        nextStep={null}
      />,
    );
    expect(primaryButtons(container)).toHaveLength(1);
    expect(primaryButtons(container)[0]).toBe(openLoan());
  });
});
