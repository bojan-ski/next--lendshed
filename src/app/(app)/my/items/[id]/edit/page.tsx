import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ItemEditSection from "@/components/items/ItemEditSection";
import ItemEditSkeleton from "@/components/items/ItemEditSkeleton";
import { Icon } from "@/components/ui/icons";
import { items } from "@/strings/items";

export const metadata: Metadata = { title: items.editTitle };

export default function EditItemPage({
  params,
}: PageProps<"/my/items/[id]/edit">) {
  return (
    <div className="flex max-w-160 flex-col gap-6">
      <Link
        href="/my/items"
        aria-label={items.backLabel}
        className="inline-flex min-h-11 items-center gap-2 self-start font-bold text-accent"
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
