import type { Metadata } from "next";
import { Suspense } from "react";
import { MY_ITEMS_HEADING_ID } from "@/components/items/ids";
import OwnItemsSection from "@/components/items/OwnItemsSection";
import OwnItemsTableSkeleton from "@/components/items/OwnItemsTableSkeleton";
import { items } from "@/strings/items";

export const metadata: Metadata = { title: items.myItemsTitle };

export default function MyItemsPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 id={MY_ITEMS_HEADING_ID} className="text-2xl font-bold">
        {items.myItemsTitle}
      </h1>
      <Suspense fallback={<OwnItemsTableSkeleton />}>
        <OwnItemsSection />
      </Suspense>
    </div>
  );
}
