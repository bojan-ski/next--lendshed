import { t } from "@/lib/text/interpolate";
import { items } from "@/strings/items";
import type { ItemEditDTO } from "@/types/item";

// A retired item is terminal: its details as text, no forms and no buttons.
export default function ItemReadOnly({
  item,
  categoryName,
}: {
  item: ItemEditDTO;
  categoryName: string;
}) {
  const facts: [string, string][] = [
    [items.categoryLabel, categoryName],
    [items.conditionLabel, items.condition[item.condition]],
    [
      items.maxLoanDaysLabel,
      t(
        item.maxLoanDays === 1 ? items.maxLoanDaysOne : items.maxLoanDaysOther,
        {
          count: item.maxLoanDays,
        },
      ),
    ],
    [items.descriptionReadOnly, item.description || items.none],
    [items.pickupNotesReadOnly, item.pickupNotes ?? items.none],
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted">{items.retiredLine}</p>
      <dl className="flex flex-col gap-4 rounded-card border border-line bg-card p-6">
        {facts.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <dt className="font-bold">{label}</dt>
            <dd className="whitespace-pre-line wrap-break-word">{value}</dd>
          </div>
        ))}
        {item.retiredNote !== null && (
          <div className="flex flex-col gap-1">
            <dt className="font-bold">{items.retiredNoteLabel}</dt>
            <dd className="whitespace-pre-line wrap-break-word">
              {item.retiredNote}
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
