import Card from "@/components/ui/Card";
import { formatDate, formatDateRange } from "@/lib/dates/dates";
import { cn } from "@/lib/text/cn";
import { t } from "@/lib/text/interpolate";
import { itemPage } from "@/strings/itemPage";
import type { BookedRangeDTO } from "@/types/item";

type BookedRangesProps = { ranges: BookedRangeDTO[]; today: string };

// Dates only, never who holds the item. Still-out rows come first from the data.
export default function BookedRanges({ ranges, today }: BookedRangesProps) {
  return (
    <Card className="flex flex-col gap-3.5 p-6 sm:px-8 sm:py-7.5">
      <h2 className="type-section-title">{itemPage.bookedHeading}</h2>
      {ranges.length === 0 ? (
        <p className="text-muted">{itemPage.nothingBooked}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranges.map((range) => (
            <li
              key={`${range.startDate}-${range.endDate}-${range.stillOut}`}
              className="flex items-center gap-3 rounded-control bg-page px-4 py-3"
            >
              <span
                aria-hidden
                className={cn(
                  "size-2.5 shrink-0 rounded-full",
                  range.stillOut ? "bg-overdue" : "bg-primary",
                )}
              />
              {range.stillOut
                ? t(itemPage.stillOut, {
                    date: formatDate(range.endDate, today),
                  })
                : formatDateRange(range.startDate, range.endDate, today)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
