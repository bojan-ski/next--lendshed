import { OPEN_INVITATIONS_HEADING_ID } from "@/components/invitations/ids";
import RevokeInvitationButton from "@/components/invitations/RevokeInvitationButton";
import { rowTableSm as row } from "@/components/ui/row-table-styles";
import { communityToday, formatDate } from "@/lib/dates/dates";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { invitations } from "@/strings/invitations";
import type { InvitationRowDTO } from "@/types/invitation";

// A table from 640 px; below that each row stacks, with its meta lines labelled.
export default function InvitationsTable({
  rows,
  today,
}: {
  rows: InvitationRowDTO[];
  today: string;
}) {
  return (
    <table aria-labelledby={OPEN_INVITATIONS_HEADING_ID} className={row.table}>
      <thead className={row.head}>
        <tr>
          <th scope="col" className={row.headCell}>
            {invitations.columnNote}
          </th>
          <th scope="col" className={row.headCell}>
            {invitations.columnCreatedBy}
          </th>
          <th scope="col" className={row.headCell}>
            {invitations.columnExpires}
          </th>
          <th scope="col">
            <span className="sr-only">{invitations.columnActions}</span>
          </th>
        </tr>
      </thead>
      <tbody className={row.body}>
        {rows.map((invitation) => {
          const expires = formatDate(
            communityToday(new Date(invitation.expiresAt)),
            today,
          );
          return (
            <tr
              key={invitation.id}
              className={cn(
                row.row,
                "max-sm:flex max-sm:flex-col max-sm:gap-1",
              )}
            >
              <td className={cn(row.cell, invitation.note && "font-bold")}>
                {invitation.note ?? (
                  <span className="font-normal text-muted">
                    {invitations.noNote}
                  </span>
                )}
              </td>
              <td className={cn(row.cell, "max-sm:text-sm max-sm:text-muted")}>
                <span className="sm:hidden">
                  {t(invitations.createdBy, { name: invitation.createdByName })}
                </span>
                <span className="max-sm:hidden">
                  {invitation.createdByName}
                </span>
              </td>
              <td className={cn(row.cell, "max-sm:text-sm max-sm:text-muted")}>
                <span className="sm:hidden">
                  {t(invitations.expires, { date: expires })}
                </span>
                <span className="max-sm:hidden">{expires}</span>
              </td>
              <td className={cn(row.cell, "text-right max-sm:pt-2")}>
                <RevokeInvitationButton
                  id={invitation.id}
                  label={
                    invitation.note
                      ? t(invitations.revokeFor, { note: invitation.note })
                      : t(invitations.revokeExpiring, { date: expires })
                  }
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
