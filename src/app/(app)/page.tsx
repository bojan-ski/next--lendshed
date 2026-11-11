import type { Metadata } from "next";
import { Suspense } from "react";
import BrowseSection from "@/components/browse/BrowseSection";
import ItemGridSkeleton from "@/components/items/ItemGridSkeleton";
import { env } from "@/lib/env/server";
import { home } from "@/strings/home";

export const metadata: Metadata = { title: home.title };

export default function HomePage({ searchParams }: PageProps<"/">) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold">{env.COMMUNITY_NAME}</h1>
        <p className="text-muted">{home.subheading}</p>
      </div>
      <Suspense fallback={<ItemGridSkeleton withFilters />}>
        <BrowseSection searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
