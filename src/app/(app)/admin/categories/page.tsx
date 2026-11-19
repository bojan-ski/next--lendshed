import type { Metadata } from "next";
import { Suspense } from "react";
import CategoriesSection from "@/components/categories/CategoriesSection";
import CategoriesTableSkeleton from "@/components/categories/CategoriesTableSkeleton";
import { CATEGORIES_HEADING_ID } from "@/components/categories/ids";
import NewCategoryForm from "@/components/categories/NewCategoryForm";
import { categories } from "@/strings/categories";

export const metadata: Metadata = { title: categories.title };

// A member gets notFound() from the layout gate, which stops dev-time instant
// validation and logs a console error (spec 27, W-05).
export const instant = false;

export default function CategoriesPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="type-page-title">{categories.title}</h1>
      <NewCategoryForm />
      <section
        aria-labelledby={CATEGORIES_HEADING_ID}
        className="flex flex-col gap-4"
      >
        <h2
          id={CATEGORIES_HEADING_ID}
          tabIndex={-1}
          className="type-section-title"
        >
          {categories.listHeading}
        </h2>
        <Suspense fallback={<CategoriesTableSkeleton />}>
          <CategoriesSection />
        </Suspense>
      </section>
    </div>
  );
}
