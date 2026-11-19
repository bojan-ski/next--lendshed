import type { Metadata } from "next";
import { Suspense } from "react";
import BrowseSection from "@/components/browse/BrowseSection";
import ItemGridSkeleton from "@/components/items/ItemGridSkeleton";
import { home } from "@/strings/home";

export const metadata: Metadata = { title: home.title };

// The heading lives in BrowseHero, rendered by the section and its skeleton.
export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<ItemGridSkeleton withFilters />}>
      <BrowseSection searchParams={searchParams} />
    </Suspense>
  );
}
