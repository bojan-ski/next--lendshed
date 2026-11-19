import DeleteCategoryButton from "@/components/categories/DeleteCategoryButton";
import { CATEGORIES_HEADING_ID } from "@/components/categories/ids";
import RenameCategoryForm from "@/components/categories/RenameCategoryForm";
import { rowTableLg as row } from "@/components/ui/row-table-styles";
import { cn } from "@/lib/text/cn";
import { categoryHues, hueStyle, type Hue } from "@/lib/text/hue";
import { categories } from "@/strings/categories";
import type { AdminCategoryDTO } from "@/types/categories";

// A table from 1024 px; below that each row stacks: the name, then its buttons.
export default function CategoriesTable({
  categories: rows,
}: {
  categories: AdminCategoryDTO[];
}) {
  const hues = categoryHues(rows);
  return (
    <table aria-labelledby={CATEGORIES_HEADING_ID} className={row.table}>
      <thead className={row.head}>
        <tr>
          <th scope="col" className={row.headCell}>
            {categories.columnName}
          </th>
          <th scope="col">
            <span className="sr-only">{categories.columnActions}</span>
          </th>
        </tr>
      </thead>
      <tbody className={row.body}>
        {rows.map((category) => (
          <tr
            key={category.id}
            className={cn(row.row, "max-lg:flex max-lg:flex-col max-lg:gap-2")}
          >
            <th
              scope="row"
              className={cn(row.cell, "text-lg font-bold wrap-break-word")}
            >
              <span className="flex items-center gap-3">
                <span
                  aria-hidden
                  style={hueStyle(hues.get(category.id) as Hue)}
                  className="size-3 shrink-0 rounded-full bg-hue-strong"
                />
                {category.name}
              </span>
            </th>
            <td className={row.cell}>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <RenameCategoryForm category={category} />
                {category.inUse ? (
                  <p className="flex items-center text-sm text-muted lg:h-12 lg:min-w-18">
                    {categories.inUse}
                  </p>
                ) : (
                  <DeleteCategoryButton category={category} />
                )}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
