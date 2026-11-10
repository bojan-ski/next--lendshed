import { render, screen } from "@testing-library/react";
import { formatDate } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { invitations } from "@/strings/invitations";
import type { InvitationRowDTO } from "@/types/invitation";
import { OPEN_INVITATIONS_HEADING_ID } from "./ids";
import InvitationsTable from "./InvitationsTable";

vi.mock("@/actions/invitations", () => ({
  joinWithInvitation: vi.fn(),
  createInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));

const TODAY = "2026-11-10";
// Noon UTC is the same calendar day in the community time zone.
const rows: InvitationRowDTO[] = [
  {
    id: "a",
    note: "Mira, no. 14",
    expiresAt: "2026-11-17T12:00:00.000Z",
    createdByName: "Ada O.",
  },
  {
    id: "b",
    note: null,
    expiresAt: "2026-11-16T12:00:00.000Z",
    createdByName: "Ada O.",
  },
];

function renderTable() {
  render(
    <>
      <h2 id={OPEN_INVITATIONS_HEADING_ID}>{invitations.openHeading}</h2>
      <InvitationsTable rows={rows} today={TODAY} />
    </>,
  );
}

describe("InvitationsTable", () => {
  test("is named by the Open invitations heading", () => {
    renderTable();
    expect(
      screen.getByRole("table", { name: invitations.openHeading }),
    ).toBeInTheDocument();
  });

  test("each Revoke button names its invitation: by note, else by expiry", () => {
    renderTable();
    expect(
      screen.getByRole("button", {
        name: t(invitations.revokeFor, { note: "Mira, no. 14" }),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: t(invitations.revokeExpiring, {
          date: formatDate("2026-11-16", TODAY),
        }),
      }),
    ).toBeInTheDocument();
  });

  test("a row without a note shows the muted placeholder", () => {
    renderTable();
    expect(screen.getByText(invitations.noNote)).toBeInTheDocument();
  });
});
