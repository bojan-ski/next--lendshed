import type { Metadata } from "next";
import { Suspense } from "react";
import MyLoansSection from "@/components/loans/MyLoansSection";
import MyLoansSkeleton from "@/components/loans/MyLoansSkeleton";
import { myLoans } from "@/strings/myLoans";

export const metadata: Metadata = { title: myLoans.title };

// The tab is URL data: read only inside the Suspense'd section.
export default function MyLoansPage({ searchParams }: PageProps<"/my/loans">) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{myLoans.title}</h1>
      <Suspense fallback={<MyLoansSkeleton />}>
        <MyLoansSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
