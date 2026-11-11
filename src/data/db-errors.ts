import "server-only";
import { Prisma } from "@/generated/prisma/client";

// Under the pg adapter an exclusion violation is a generic P2039; only the
// driver's own SQLSTATE says it was loan_no_overlap.
export function isDatesTaken(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const cause = (error.meta?.driverAdapterError as { cause?: unknown })?.cause;
  return (cause as { originalCode?: unknown })?.originalCode === "23P01";
}
