import Link from "next/link";
import RequestLoanForm from "@/components/items/RequestLoanForm";
import Notice from "@/components/ui/Notice";
import { addDays } from "@/lib/dates/dates";
import { REQUEST_AHEAD_DAYS, REQUEST_LIMITS } from "@/lib/loans/limits";
import { t } from "@/lib/text/interpolate";
import { requestForm } from "@/strings/requestForm";
import type { ItemDetailDTO } from "@/types/item";

type RequestCardProps = { item: ItemDetailDTO; today: string };

function BlockedLine({
  block,
}: {
  block: NonNullable<ItemDetailDTO["requestBlock"]>;
}) {
  if (block === "contact_details") {
    return (
      <>
        {requestForm.blockedContactDetails}{" "}
        <Link href="/account" className="font-bold text-accent-ink underline">
          {requestForm.accountLink}
        </Link>
      </>
    );
  }
  return block === "item_limit"
    ? requestForm.itemLimit
    : t(requestForm.overallLimit, { limit: REQUEST_LIMITS.overall });
}

// Another member's item only: the form, or why it can't be requested now.
export default function RequestCard({ item, today }: RequestCardProps) {
  return (
    <div className="surface-accent flex flex-col gap-4.5 rounded-card p-6 sm:p-8">
      <h2 className="type-section-title lg:text-4xl">{requestForm.heading}</h2>
      {item.requestBlock === null ? (
        <RequestLoanForm
          itemId={item.id}
          ownerName={item.owner.displayName}
          maxLoanDays={item.maxLoanDays}
          minStart={today}
          maxStart={addDays(today, REQUEST_AHEAD_DAYS)}
        />
      ) : (
        <Notice tone="info">
          <BlockedLine block={item.requestBlock} />
        </Notice>
      )}
    </div>
  );
}
