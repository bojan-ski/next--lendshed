import { render, screen, within } from "@testing-library/react";
import { MEMBERS_HEADING_ID } from "@/components/members/ids";
import { t } from "@/lib/text/interpolate";
import { members } from "@/strings/members";
import { status } from "@/strings/status";
import type { AdminMemberRowDTO } from "@/types/members";
import MembersTable from "./MembersTable";

const rows: AdminMemberRowDTO[] = [
  {
    id: "m-1",
    displayName: "Ada P.",
    initials: "AP",
    role: "organizer",
    status: "active",
    openLoanCount: 0,
  },
  {
    id: "m-2",
    displayName: "Tom B.",
    initials: "TB",
    role: "member",
    status: "suspended",
    openLoanCount: 1,
  },
];

function renderTable() {
  render(
    <>
      <h1 id={MEMBERS_HEADING_ID}>{members.title}</h1>
      <MembersTable rows={rows} />
    </>,
  );
}

describe("MembersTable", () => {
  test("is named by the page heading, with one row per member", () => {
    renderTable();
    const table = screen.getByRole("table", { name: members.title });
    expect(within(table).getAllByRole("row")).toHaveLength(rows.length + 1);
  });

  test("shows the role and status labels from the strings, never raw values", () => {
    renderTable();
    const tom = screen.getByRole("row", { name: /Tom B\./ });
    expect(within(tom).getByText(members.role.member)).toBeInTheDocument();
    expect(within(tom).getByText(status.member.suspended)).toBeInTheDocument();
    expect(
      within(tom).getByText(t(members.openLoansOne, { count: 1 })),
    ).toBeInTheDocument();
  });

  test("each Open link names its member and goes to the detail page", () => {
    renderTable();
    for (const row of rows) {
      const link = screen.getByRole("link", {
        name: t(members.openFor, { name: row.displayName }),
      });
      expect(link).toHaveAttribute("href", `/admin/members/${row.id}`);
      expect(link).toHaveTextContent(members.open);
    }
  });
});
