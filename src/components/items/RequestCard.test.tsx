import { render, screen } from "@testing-library/react";
import { addDays } from "@/lib/dates/dates";
import { REQUEST_AHEAD_DAYS, REQUEST_LIMITS } from "@/lib/loans/limits";
import { t } from "@/lib/text/interpolate";
import { requestForm } from "@/strings/requestForm";
import type { ItemDetailDTO } from "@/types/item";
import RequestCard from "./RequestCard";

vi.mock("@/actions/loans", () => ({ requestLoan: vi.fn() }));

const TODAY = "2030-06-15";

const item = (requestBlock: ItemDetailDTO["requestBlock"]): ItemDetailDTO => ({
  id: "item-1",
  title: "Step ladder",
  categoryName: "Garden",
  ownerName: "Olga M.",
  ownerArea: null,
  photo: null,
  freeToday: true,
  description: "",
  condition: "good",
  maxLoanDays: 7,
  pickupNotes: null,
  status: "listed",
  owner: { id: "owner-1", displayName: "Olga M.", area: null },
  bookedRanges: [],
  isOwn: false,
  requestBlock,
  viewerCanRequest: requestBlock === null,
  viewerCanRetireAsOrganizer: false,
});

describe("RequestCard", () => {
  test("no block: the form, with the window counted from the server's today", () => {
    render(<RequestCard item={item(null)} today={TODAY} />);

    expect(
      screen.getByRole("heading", { level: 2, name: requestForm.heading }),
    ).toBeInTheDocument();
    const from = screen.getByLabelText(requestForm.from);
    expect(from).toHaveAttribute("min", TODAY);
    expect(from).toHaveAttribute("max", addDays(TODAY, REQUEST_AHEAD_DAYS));
    expect(
      screen.getByRole("button", { name: requestForm.send }),
    ).toBeInTheDocument();
  });

  test("contact_details: the sentence and the account link, no form", () => {
    render(<RequestCard item={item("contact_details")} today={TODAY} />);

    expect(
      screen.getByText(requestForm.blockedContactDetails, { exact: false }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: requestForm.accountLink }),
    ).toHaveAttribute("href", "/account");
    expect(screen.queryByRole("button")).toBeNull();
  });

  test.each([
    ["item_limit", requestForm.itemLimit],
    [
      "overall_limit",
      t(requestForm.overallLimit, { limit: REQUEST_LIMITS.overall }),
    ],
  ] as const)("%s: its line, no form", (block, text) => {
    render(<RequestCard item={item(block)} today={TODAY} />);

    expect(screen.getByText(text)).toBeInTheDocument();
    expect(screen.queryByLabelText(requestForm.from)).toBeNull();
  });
});
