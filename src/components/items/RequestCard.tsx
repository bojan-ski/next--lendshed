import Link from "next/link";
import RequestLoanForm from "@/components/items/RequestLoanForm";
import Card from "@/components/ui/Card";
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
        <Link href="/account" className="font-bold text-accent underline">
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
    <Card className="flex flex-col gap-4 p-6">
      <h2 className="text-xl font-bold">{requestForm.heading}</h2>
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
    </Card>
  );
}
