import Link from "next/link";
import { MY_ITEMS_HEADING_ID } from "@/components/items/ids";
import ButtonLink from "@/components/ui/ButtonLink";
import { Icon } from "@/components/ui/icons";
import PhotoImage from "@/components/ui/PhotoImage";
import PhotoPlaceholder from "@/components/ui/PhotoPlaceholder";
import StatusLabel from "@/components/ui/StatusLabel";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { itemStatus } from "@/lib/text/status";
import { items } from "@/strings/items";
import type { OwnItemRowDTO } from "@/types/item";

// From 1024 px each row is a white band: the cells share its background and
// the outer ones round its ends.
const cell = "align-middle lg:bg-card lg:px-2.5 lg:py-3.5";
const first = "lg:rounded-l-tile lg:pl-5";
const last = "lg:rounded-r-tile lg:pr-5";

function NowLine({ now }: { now: OwnItemRowDTO["now"] }) {
  return (
    <span
      className={cn(
        "inline-flex items-start gap-1.5",
        now.kind === "overdue" && "font-bold text-overdue",
      )}
    >
      {now.kind === "overdue" && (
        <Icon name="alert" size={16} aria-hidden className="mt-1 shrink-0" />
      )}
      {t(items.now[now.kind], { name: now.personName ?? "" })}
    </span>
  );
}

// A table from 1024 px; below that each row stacks on its own card: thumbnail
// and title, then the label and the Now line, then a full-width Edit or View
// link. A listed item's title opens its page, as neighbours see it.
export default function OwnItemsTable({ rows }: { rows: OwnItemRowDTO[] }) {
  return (
    <table
      aria-labelledby={MY_ITEMS_HEADING_ID}
      className="w-full border-separate border-spacing-y-2.5 text-left max-lg:block"
    >
      <thead className="text-sm text-muted max-lg:sr-only">
        <tr>
          <th scope="col" className="px-2.5 pl-5 font-normal">
            {items.columnItem}
          </th>
          <th scope="col" className="px-2.5 font-normal">
            {items.columnStatus}
          </th>
          <th scope="col" className="px-2.5 font-normal">
            {items.columnNow}
          </th>
          <th scope="col">
            <span className="sr-only">{items.columnActions}</span>
          </th>
        </tr>
      </thead>
      <tbody className="max-lg:flex max-lg:flex-col max-lg:gap-2.5">
        {rows.map((row) => {
          const retired = row.status === "retired";
          return (
            <tr
              key={row.id}
              className="max-lg:flex max-lg:flex-wrap max-lg:items-center max-lg:gap-x-3 max-lg:gap-y-2.5 max-lg:rounded-tile max-lg:bg-card max-lg:p-4"
            >
              <th
                scope="row"
                className={cn(cell, first, "font-normal max-lg:w-full")}
              >
                <span className="flex min-w-0 items-center gap-4">
                  {/* Decorative: the title and the labelled link sit beside it. */}
                  {row.photo ? (
                    <PhotoImage
                      photo={row.photo}
                      alt=""
                      className="size-15 shrink-0 rounded-thumb object-cover"
                    />
                  ) : (
                    <PhotoPlaceholder className="size-15 shrink-0 rounded-thumb" />
                  )}
                  {row.status === "listed" ? (
                    <Link
                      href={`/items/${row.id}`}
                      className="inline-flex min-h-11 items-center wrap-break-word text-accent-ink underline underline-offset-4 type-card-title"
                    >
                      {row.title}
                    </Link>
                  ) : (
                    <span className="wrap-break-word type-card-title">
                      {row.title}
                    </span>
                  )}
                </span>
              </th>
              <td className={cell}>
                <StatusLabel status={itemStatus[row.status]} />
              </td>
              <td className={cn(cell, "max-lg:text-sm")}>
                <NowLine now={row.now} />
              </td>
              <td className={cn(cell, last, "text-right max-lg:w-full")}>
                <ButtonLink
                  href={`/my/items/${row.id}/edit`}
                  variant="outline"
                  aria-label={t(retired ? items.viewFor : items.editFor, {
                    title: row.title,
                  })}
                  className="px-5 max-lg:w-full"
                >
                  {retired ? items.view : items.edit}
                </ButtonLink>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
