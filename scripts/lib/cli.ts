import { Prisma } from "@/generated/prisma/client";

// Operator output names the database host only: never the URL, user or password.
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname || "(unknown host)";
  } catch {
    return "(unknown host)";
  }
}

function prismaCode(error: unknown): string | undefined {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code;
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return error.errorCode;
  }
  return undefined;
}

// The error's class and Prisma code, never its message (it can quote the URL).
export function failureLine(error: unknown): string {
  const name = error instanceof Error ? error.name : typeof error;
  const code = prismaCode(error);
  return code ? `Failed: ${name} (${code})` : `Failed: ${name}`;
}
