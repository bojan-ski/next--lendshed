import { MY_ITEMS_HEADING_ID } from "@/components/items/ids";
import ButtonLink from "@/components/ui/ButtonLink";
import Card from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { itemStatus } from "@/lib/text/status";
import { items } from "@/strings/items";
import type { OwnItemRowDTO } from "@/types/item";

const cell = "py-3 pr-4 align-middle max-lg:p-0";

function NowLine({ now }: { now: OwnItemRowDTO["now"] }) {
  return (
    <span className="inline-flex items-start gap-1.5">
      {now.kind === "overdue" && (
        <Icon name="alert" size={16} aria-hidden className="mt-0.5 shrink-0" />
      )}
      {t(items.now[now.kind], { name: now.personName ?? "" })}
    </span>
  );
}

// A table from 1024 px; below that each row stacks: thumbnail and title, then
// the label and the Now line, then a full-width Edit or View link.
export default function OwnItemsTable({ rows }: { rows: OwnItemRowDTO[] }) {
  return (
    <Card className="px-4">
      <table aria-labelledby={MY_ITEMS_HEADING_ID} className="w-full text-left">
        <thead className="text-sm text-muted max-lg:sr-only">
          <tr>
            <th scope="col" className="py-3 pr-4 font-normal">
              {items.columnItem}
            </th>
            <th scope="col" className="py-3 pr-4 font-normal">
              {items.columnStatus}
            </th>
            <th scope="col" className="py-3 pr-4 font-normal">
              {items.columnNow}
            </th>
            <th scope="col" className="py-3">
              <span className="sr-only">{items.columnActions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const retired = row.status === "retired";
            return (
              <tr
                key={row.id}
                className="border-t border-line max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-2 max-lg:py-3 max-lg:first:border-t-0"
              >
                <th
                  scope="row"
                  className={cn(cell, "font-normal max-lg:w-full")}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    {/* Decorative: the title and the labelled link sit beside it. */}
                    {row.photo ? (
                      <PhotoImage
                        photo={row.photo}
                        alt=""
                        className="size-12 shrink-0 rounded-control object-cover"
                      />
                    ) : (
                      <PhotoPlaceholder className="size-12 shrink-0 rounded-control" />
                    )}
                    <span className="font-bold wrap-break-word">
                      {row.title}
                    </span>
                  </span>
                </th>
                <td className={cell}>
                  <StatusLabel status={itemStatus[row.status]} />
                </td>
                <td className={cn(cell, "max-lg:text-sm max-lg:text-muted")}>
                  <NowLine now={row.now} />
                </td>
                <td className="py-3 text-right max-lg:w-full max-lg:p-0">
                  <ButtonLink
                    href={`/my/items/${row.id}/edit`}
                    variant="outline"
                    aria-label={t(retired ? items.viewFor : items.editFor, {
                      title: row.title,
                    })}
                    className="max-lg:w-full"
                  >
                    {retired ? items.view : items.edit}
                  </ButtonLink>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}
