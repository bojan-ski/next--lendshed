import CategoriesTable from "@/components/categories/CategoriesTable";
import EmptyState from "@/components/ui/EmptyState";
import { getAdminCategories } from "@/data/categories";
import { requireOrganizer } from "@/lib/auth/guards";
import { categories } from "@/strings/categories";

// Guards itself: the admin layout doesn't re-run on a soft navigation.
export default async function CategoriesSection() {
  await requireOrganizer();
  const rows = await getAdminCategories();
  if (rows.length === 0) {
    return (
      <EmptyState
        icon="tag"
        heading={categories.emptyHeading}
        body={categories.emptyBody}
        headingLevel="h3"
      />
    );
  }
  return <CategoriesTable categories={rows} />;
}
