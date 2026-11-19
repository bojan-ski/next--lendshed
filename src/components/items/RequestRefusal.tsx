import Link from "next/link";
import { REQUEST_LIMITS } from "@/lib/loans/limits";
import { t } from "@/lib/text/interpolate";
import { errors } from "@/strings/errors";
import { requestForm } from "@/strings/requestForm";
import type { RequestLoanState } from "@/types/loan";

// The notice body for a refused request.
export default function RequestRefusal({
  formError,
}: {
  formError: NonNullable<RequestLoanState["formError"]>;
}) {
  switch (formError) {
    case "needsContactDetails":
      return (
        <>
          {requestForm.needsContactDetails}{" "}
          <Link href="/account" className="font-bold text-accent-ink underline">
            {requestForm.accountLink}
          </Link>
        </>
      );
    case "overallLimit":
      return t(requestForm.overallLimit, { limit: REQUEST_LIMITS.overall });
    case "unexpected":
      return errors.actionFailed;
    default:
      return requestForm[formError];
  }
}
