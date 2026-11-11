// Trimmed, inner whitespace runs collapsed: the form a category name is stored in.
export function normaliseCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

// What the unique index compares, so names differing only in case collide.
export function categoryNameKey(name: string): string {
  return normaliseCategoryName(name).toLowerCase();
}
