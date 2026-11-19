import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ItemDetailSection from "@/components/items/ItemDetailSection";
import ItemDetailSkeleton from "@/components/items/ItemDetailSkeleton";
import { Icon } from "@/components/ui/icons";
import { backLinkClasses } from "@/components/ui/link-styles";
import { app } from "@/strings/app";
import { itemPage } from "@/strings/itemPage";

// Static title: a per-item title would cost a read and could name a hidden item.
export const metadata: Metadata = { title: itemPage.title };

export default function ItemPage({ params }: PageProps<"/items/[id]">) {
  return (
    <div className="flex flex-col gap-6">
      <Link href="/" aria-label={itemPage.back} className={backLinkClasses}>
        <Icon name="arrow-left" aria-hidden />
        {app.back}
      </Link>
      <Suspense fallback={<ItemDetailSkeleton />}>
        <ItemDetailSection params={params} />
      </Suspense>
    </div>
  );
}
