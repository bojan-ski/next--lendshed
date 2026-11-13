import { render, screen } from "@testing-library/react";
import { formatDate } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { strings } from "@/strings";
import type { LoanDetailDTO } from "@/types/loan";
import LoanNextSteps from "./LoanNextSteps";

const TODAY = "2026-11-13";

const returned: LoanDetailDTO = {
  id: "loan-1",
  status: "returned",
  startDate: "2026-11-02",
  endDate: "2026-11-06",
  lengthDays: 5,
  item: {
    id: "item-1",
    title: "Step ladder",
    photo: null,
    status: "listed",
    viewable: true,
  },
  owner: { displayName: "Ruth K." },
  borrower: { displayName: "Sam P." },
  viewerRole: "borrower",
  requestMessage: null,
  statusReason: null,
  endedBy: null,
  systemReason: null,
  returnedOn: "2026-11-10",
  returnedAsLent: "yes",
  closedByName: null,
  overlappingRequestCount: 0,
  handOverBlocked: false,
  contact: null,
  actions: [],
};

const { ended } = strings.loanPage;
const backLine = t(ended.returned, {
  date: formatDate("2026-11-10", TODAY),
});

describe("LoanNextSteps — a returned loan", () => {
  test("as lent: the back line only", () => {
    render(<LoanNextSteps loan={returned} today={TODAY} />);
    expect(screen.getByText(backLine)).toBeInTheDocument();
    expect(screen.queryByText(ended.notAsLent)).not.toBeInTheDocument();
    expect(screen.queryByText(ended.asLentUnknown)).not.toBeInTheDocument();
  });

  test.each([
    ["no", ended.notAsLent, ended.asLentUnknown],
    ["unknown", ended.asLentUnknown, ended.notAsLent],
  ] as const)(
    "as lent %s: its own line, never the other",
    (asLent, shown, hidden) => {
      render(
        <LoanNextSteps
          loan={{ ...returned, returnedAsLent: asLent }}
          today={TODAY}
        />,
      );
      expect(screen.getByText(shown)).toBeInTheDocument();
      expect(screen.queryByText(hidden)).not.toBeInTheDocument();
    },
  );

  test("an organizer's close: who closed it, then the note, for every viewer", () => {
    for (const viewerRole of ["owner", "borrower", "organizer"] as const) {
      const { unmount } = render(
        <LoanNextSteps
          loan={{
            ...returned,
            viewerRole,
            returnedAsLent: "unknown",
            closedByName: "Ana M.",
            statusReason: "Owner unreachable.",
          }}
          today={TODAY}
        />,
      );
      expect(
        screen.getByText(t(ended.closedBy, { name: "Ana M." })),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          t(strings.loanPage.reasonQuote, { reason: "Owner unreachable." }),
        ),
      ).toBeInTheDocument();
      unmount();
    }
  });
});
