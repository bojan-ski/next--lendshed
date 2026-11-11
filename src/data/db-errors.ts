import "server-only";
import { Prisma } from "@/generated/prisma/client";

// Under the pg adapter an exclusion violation is a generic P2039; only the
// driver's own SQLSTATE says it was loan_no_overlap.
export function isDatesTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const cause = (error.meta?.driverAdapterError as { cause?: unknown })?.cause;
  return (cause as { originalCode?: unknown })?.originalCode === "23P01";
}

// A P2003 names the constraint, or the column when the driver reports one.
function foreignKeyViolation(
  error: unknown,
): { index?: unknown; fields?: unknown } | null {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return null;
  if (error.code !== "P2003") return null;
  const cause = (error.meta?.driverAdapterError as { cause?: unknown })?.cause;
  return (
    (cause as { constraint?: { index?: unknown; fields?: unknown } })
      ?.constraint ?? {}
  );
}

export function isCategoryReferenced(error: unknown): boolean {
  const constraint = foreignKeyViolation(error);
  return (
    constraint?.index === "item_categoryId_fkey" ||
    (Array.isArray(constraint?.fields) &&
      constraint.fields.includes("categoryId"))
  );
}

export function isItemReferencedByLoan(error: unknown): boolean {
  const constraint = foreignKeyViolation(error);
  return (
    constraint?.index === "loan_itemId_fkey" ||
    (Array.isArray(constraint?.fields) && constraint.fields.includes("itemId"))
  );
}
