import DeleteCategoryButton from "@/components/categories/DeleteCategoryButton";
import { CATEGORIES_HEADING_ID } from "@/components/categories/ids";
import RenameCategoryForm from "@/components/categories/RenameCategoryForm";
import Card from "@/components/ui/Card";
import { categories } from "@/strings/categories";
import type { AdminCategoryDTO } from "@/types/categories";

// A table from 1024 px; below that each row stacks: the name, then its buttons.
export default function CategoriesTable({
  categories: rows,
}: {
  categories: AdminCategoryDTO[];
}) {
  return (
    <Card className="px-4">
      <table
        aria-labelledby={CATEGORIES_HEADING_ID}
        className="w-full text-left"
      >
        <thead className="text-sm text-muted max-lg:sr-only">
          <tr>
            <th scope="col" className="py-3 pr-4 font-normal">
              {categories.columnName}
            </th>
            <th scope="col" className="py-3">
              <span className="sr-only">{categories.columnActions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-t border-line max-lg:flex max-lg:flex-col max-lg:gap-2 max-lg:py-3 max-lg:first:border-t-0"
            >
              <th
                scope="row"
                className="py-3 pr-4 align-middle font-normal wrap-break-word max-lg:p-0"
              >
                {row.name}
              </th>
              <td className="py-3 align-middle max-lg:p-0">
                <div className="flex flex-wrap items-start gap-2 lg:justify-end">
                  <RenameCategoryForm category={row} />
                  {row.inUse ? (
                    <p className="flex h-12 items-center text-sm text-muted">
                      {categories.inUse}
                    </p>
                  ) : (
                    <DeleteCategoryButton category={row} />
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
