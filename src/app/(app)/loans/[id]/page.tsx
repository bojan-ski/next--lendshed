import type { Metadata } from "next";
import { Suspense } from "react";
import LoanDetailSection from "@/components/loans/LoanDetailSection";
import LoanDetailSkeleton from "@/components/loans/LoanDetailSkeleton";
import { loanPage } from "@/strings/loanPage";

// Static title: a per-loan title would cost a read and could name the item.
export const metadata: Metadata = { title: loanPage.title };

export default function LoanPage({ params }: PageProps<"/loans/[id]">) {
  return (
    <Suspense fallback={<LoanDetailSkeleton />}>
      <LoanDetailSection params={params} />
    </Suspense>
  );
}
