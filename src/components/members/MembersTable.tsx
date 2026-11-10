import { MEMBERS_HEADING_ID } from "@/components/members/ids";
import Avatar from "@/components/ui/Avatar";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import StatusLabel from "@/components/ui/StatusLabel";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { memberStatus } from "@/lib/text/status";
import { members } from "@/strings/members";
import type { AdminMemberRowDTO } from "@/types/members";

const cell = "py-3 pr-4 align-middle max-lg:p-0";

// A table from 1024 px; below that each row stacks: name, one meta line, Open.
// Not from 640 px: from 768 px the admin menu takes the width five columns need.
export default function MembersTable({ rows }: { rows: AdminMemberRowDTO[] }) {
  return (
    <Card className="px-4">
      <table aria-labelledby={MEMBERS_HEADING_ID} className="w-full text-left">
        <thead className="text-sm text-muted max-lg:sr-only">
          <tr>
            <th scope="col" className="py-3 pr-4 font-normal">
              {members.columnName}
            </th>
            <th scope="col" className="py-3 pr-4 font-normal">
              {members.columnRole}
            </th>
            <th scope="col" className="py-3 pr-4 font-normal">
              {members.columnStatus}
            </th>
            <th scope="col" className="py-3 pr-4 font-normal">
              {members.columnOpenLoans}
            </th>
            <th scope="col" className="py-3">
              <span className="sr-only">{members.columnActions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-t border-line max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-2 max-lg:py-3 max-lg:first:border-t-0"
            >
              <th scope="row" className={cn(cell, "font-normal max-lg:w-full")}>
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar initials={row.initials} aria-hidden />
                  <span className="truncate font-bold">{row.displayName}</span>
                </span>
              </th>
              <td className={cn(cell, "max-lg:text-sm max-lg:text-muted")}>
                {members.role[row.role]}
              </td>
              <td className={cell}>
                <StatusLabel status={memberStatus[row.status]} />
              </td>
              <td className={cn(cell, "max-lg:text-sm max-lg:text-muted")}>
                <span className="lg:hidden">
                  {t(
                    row.openLoanCount === 1
                      ? members.openLoansOne
                      : members.openLoansOther,
                    { count: row.openLoanCount },
                  )}
                </span>
                <span className="max-lg:hidden">{row.openLoanCount}</span>
              </td>
              <td className="py-3 text-right max-lg:w-full max-lg:p-0">
                <ButtonLink
                  href={`/admin/members/${row.id}`}
                  variant="outline"
                  aria-label={t(members.openFor, { name: row.displayName })}
                  className="max-lg:w-full"
                >
                  {members.open}
                  <Icon name="chevron-right" aria-hidden />
                </ButtonLink>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
