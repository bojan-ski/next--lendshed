import { render, screen, within } from "@testing-library/react";
import { formatDate, formatDateRange } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { itemPage } from "@/strings/itemPage";
import BookedRanges from "./BookedRanges";

const TODAY = "2030-06-15";

describe("BookedRanges", () => {
  test("rows keep their order: the still-out row first, worded as overdue", () => {
    render(
      <BookedRanges
        today={TODAY}
        ranges={[
          { startDate: "2030-06-01", endDate: "2030-06-05", stillOut: true },
          { startDate: "2030-06-13", endDate: "2030-06-16", stillOut: false },
        ]}
      />,
    );

    const rows = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      t(itemPage.stillOut, { date: formatDate("2030-06-05", TODAY) }),
      formatDateRange("2030-06-13", "2030-06-16", TODAY),
    ]);
  });

  test("a one-day loan shows one date", () => {
    render(
      <BookedRanges
        today={TODAY}
        ranges={[
          { startDate: "2030-06-20", endDate: "2030-06-20", stillOut: false },
        ]}
      />,
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      formatDate("2030-06-20", TODAY),
    );
  });

  test("no rows: the heading and one muted line", () => {
    render(<BookedRanges today={TODAY} ranges={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: itemPage.bookedHeading }),
    ).toBeInTheDocument();
    expect(screen.getByText(itemPage.nothingBooked)).toHaveClass("text-muted");
    expect(screen.queryByRole("list")).toBeNull();
  });
});
