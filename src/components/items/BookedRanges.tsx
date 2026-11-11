import Card from "@/components/ui/Card";
import { Icon } from "@/components/ui/icons";
import { formatDate, formatDateRange } from "@/lib/dates/dates";
import { t } from "@/lib/text/interpolate";
import { itemPage } from "@/strings/itemPage";
import type { BookedRangeDTO } from "@/types/item";

type BookedRangesProps = { ranges: BookedRangeDTO[]; today: string };

// Dates only, never who holds the item. Still-out rows come first from the data.
export default function BookedRanges({ ranges, today }: BookedRangesProps) {
  return (
    <Card className="flex flex-col gap-3 p-6">
      <h2 className="text-xl font-bold">{itemPage.bookedHeading}</h2>
      {ranges.length === 0 ? (
        <p className="text-muted">{itemPage.nothingBooked}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {ranges.map((range) => (
            <li
              key={`${range.startDate}-${range.endDate}-${range.stillOut}`}
              className="flex items-center gap-2"
            >
              <Icon
                name="calendar"
                aria-hidden
                className={range.stillOut ? "text-overdue" : "text-muted"}
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
