import { MEMBERS_HEADING_ID } from "@/components/members/ids";
import Avatar from "@/components/ui/Avatar";
import ButtonLink from "@/components/ui/ButtonLink";
import { Icon } from "@/components/ui/icons";
import { rowTableLg as row } from "@/components/ui/row-table-styles";
import StatusLabel from "@/components/ui/StatusLabel";
import { cn } from "@/lib/text/cn";
import { hueFor } from "@/lib/text/hue";
import { t } from "@/lib/text/interpolate";
import { memberStatus } from "@/lib/text/status";
import { members } from "@/strings/members";
import type { AdminMemberRowDTO } from "@/types/members";

// A table from 1024 px; below that each row stacks: name, one meta line, Open.
// Not from 640 px: from 768 px the admin menu takes the width five columns need.
export default function MembersTable({ rows }: { rows: AdminMemberRowDTO[] }) {
  return (
    <table aria-labelledby={MEMBERS_HEADING_ID} className={row.table}>
      <thead className={row.head}>
        <tr>
          <th scope="col" className={row.headCell}>
            {members.columnName}
          </th>
          <th scope="col" className={row.headCell}>
            {members.columnRole}
          </th>
          <th scope="col" className={row.headCell}>
            {members.columnStatus}
          </th>
          <th scope="col" className={row.headCell}>
            {members.columnOpenLoans}
          </th>
          <th scope="col">
            <span className="sr-only">{members.columnActions}</span>
          </th>
        </tr>
      </thead>
      <tbody className={row.body}>
        {rows.map((member) => (
          <tr
            key={member.id}
            className={cn(
              row.row,
              "max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-2",
            )}
          >
            <th
              scope="row"
              className={cn(row.cell, "font-normal max-lg:w-full")}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Avatar
                  initials={member.initials}
                  hue={hueFor(member.id)}
                  aria-hidden
                />
                <span className="truncate font-bold">{member.displayName}</span>
              </span>
            </th>
            <td className={cn(row.cell, "max-lg:text-sm max-lg:text-muted")}>
              {members.role[member.role]}
            </td>
            <td className={row.cell}>
              <StatusLabel status={memberStatus[member.status]} />
            </td>
            <td className={cn(row.cell, "max-lg:text-sm max-lg:text-muted")}>
              <span className="lg:hidden">
                {t(
                  member.openLoanCount === 1
                    ? members.openLoansOne
                    : members.openLoansOther,
                  { count: member.openLoanCount },
                )}
              </span>
              <span className="max-lg:hidden">{member.openLoanCount}</span>
            </td>
            <td className={cn(row.cell, "text-right max-lg:w-full")}>
              <ButtonLink
                href={`/admin/members/${member.id}`}
                variant="outline"
                aria-label={t(members.openFor, { name: member.displayName })}
                className="gap-1 pr-3 pl-5 max-lg:w-full"
              >
                {members.open}
                <Icon name="chevron-right" aria-hidden />
              </ButtonLink>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
