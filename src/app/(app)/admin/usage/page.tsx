import type { Metadata } from "next";
import { Suspense } from "react";
import UsageSection from "@/components/usage/UsageSection";
import UsageSkeleton from "@/components/usage/UsageSkeleton";
import { usage } from "@/strings/usage";

export const metadata: Metadata = { title: usage.title };

export default function UsagePage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold">{usage.title}</h1>
      <Suspense fallback={<UsageSkeleton />}>
        <UsageSection />
      </Suspense>
    </div>
  );
}
