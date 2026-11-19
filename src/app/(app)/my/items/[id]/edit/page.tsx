import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ItemEditSection from "@/components/items/ItemEditSection";
import ItemEditSkeleton from "@/components/items/ItemEditSkeleton";
import { Icon } from "@/components/ui/icons";
import { backLinkClasses } from "@/components/ui/link-styles";
import { items } from "@/strings/items";

export const metadata: Metadata = { title: items.editTitle };

export default function EditItemPage({
  params,
}: PageProps<"/my/items/[id]/edit">) {
  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/my/items"
        aria-label={items.backLabel}
        className={backLinkClasses}
      >
        <Icon name="arrow-left" aria-hidden />
        {items.back}
      </Link>
      <Suspense fallback={<ItemEditSkeleton />}>
        <ItemEditSection params={params} />
      </Suspense>
    </div>
  );
}
