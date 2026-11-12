import "server-only";
import { isIsoDate } from "@/lib/dates/dates";

// The only place a loan date becomes a JS Date: Prisma types @db.Date columns
// as Date, and the adapter reads and writes them with UTC getters.
export function toDbDate(date: string): Date {
  if (!isIsoDate(date)) throw new RangeError(`Not a YYYY-MM-DD date: ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}

// Null passes through, for the nullable `returnedOn`.
export function fromDbDate(value: Date): string;
export function fromDbDate(value: Date | null): string | null;
export function fromDbDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}
