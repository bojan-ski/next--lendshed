import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import ItemFormSkeleton from "@/components/items/ItemFormSkeleton";
import NewItemSection from "@/components/items/NewItemSection";
import { Icon } from "@/components/ui/icons";
import { backLinkClasses } from "@/components/ui/link-styles";
import { app } from "@/strings/app";
import { items } from "@/strings/items";

export const metadata: Metadata = { title: items.newTitle };

export default function NewItemPage() {
  return (
    <div className="flex max-w-190 flex-col gap-6">
      <Link
        href="/my/items"
        aria-label={items.backLabel}
        className={backLinkClasses}
      >
        <Icon name="arrow-left" aria-hidden />
        {app.back}
      </Link>
      <h1 className="type-page-title">{items.newTitle}</h1>
      <Suspense fallback={<ItemFormSkeleton />}>
        <NewItemSection />
      </Suspense>
    </div>
  );
}
