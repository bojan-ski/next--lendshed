import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Scripts pass DATABASE_URL_UNPOOLED (the direct URL) and $disconnect() in a finally.
export function createScriptClient(url: string): PrismaClient {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString: url }),
  });
}
