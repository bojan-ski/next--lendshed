import { OPEN_INVITATIONS_HEADING_ID } from "@/components/invitations/ids";
import RevokeInvitationButton from "@/components/invitations/RevokeInvitationButton";
import Card from "@/components/ui/Card";
import { communityToday, formatDate } from "@/lib/dates/dates";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { invitations } from "@/strings/invitations";
import type { InvitationRowDTO } from "@/types/invitation";

const cell = "py-3 pr-4 align-middle max-sm:p-0";

// A table from 640 px; below that each row stacks, with its meta lines labelled.
export default function InvitationsTable({
  rows,
  today,
}: {
  rows: InvitationRowDTO[];
  today: string;
}) {
  return (
    <Card className="px-4">
      <table
        aria-labelledby={OPEN_INVITATIONS_HEADING_ID}
        className="w-full text-left"
      >
        <thead className="text-sm text-muted max-sm:sr-only">
          <tr>
            <th scope="col" className="py-3 pr-4 font-normal">
              {invitations.columnNote}
            </th>
            <th scope="col" className="py-3 pr-4 font-normal">
              {invitations.columnCreatedBy}
            </th>
            <th scope="col" className="py-3 pr-4 font-normal">
              {invitations.columnExpires}
            </th>
            <th scope="col" className="py-3">
              <span className="sr-only">{invitations.columnActions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const expires = formatDate(
              communityToday(new Date(row.expiresAt)),
              today,
            );
            return (
              <tr
                key={row.id}
                className="border-t border-line max-sm:flex max-sm:flex-col max-sm:gap-1 max-sm:py-3 max-sm:first:border-t-0"
              >
                <td className={cell}>
                  {row.note ?? (
                    <span className="text-muted">{invitations.noNote}</span>
                  )}
                </td>
                <td className={cn(cell, "max-sm:text-sm max-sm:text-muted")}>
                  <span className="sm:hidden">
                    {t(invitations.createdBy, { name: row.createdByName })}
                  </span>
                  <span className="max-sm:hidden">{row.createdByName}</span>
                </td>
                <td className={cn(cell, "max-sm:text-sm max-sm:text-muted")}>
                  <span className="sm:hidden">
                    {t(invitations.expires, { date: expires })}
                  </span>
                  <span className="max-sm:hidden">{expires}</span>
                </td>
                <td className="py-3 text-right max-sm:p-0 max-sm:pt-2">
                  <RevokeInvitationButton
                    id={row.id}
                    label={
                      row.note
                        ? t(invitations.revokeFor, { note: row.note })
                        : t(invitations.revokeExpiring, { date: expires })
                    }
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
