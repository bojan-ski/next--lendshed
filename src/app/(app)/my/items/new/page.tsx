import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ItemFormSkeleton from "@/components/items/ItemFormSkeleton";
import NewItemSection from "@/components/items/NewItemSection";
import { Icon } from "@/components/ui/icons";
import { items } from "@/strings/items";

export const metadata: Metadata = { title: items.newTitle };

export default function NewItemPage() {
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
      <h1 className="text-2xl font-bold">{items.newTitle}</h1>
      <Suspense fallback={<ItemFormSkeleton />}>
        <NewItemSection />
      </Suspense>
    </div>
  );
}
