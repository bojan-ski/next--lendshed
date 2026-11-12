import { db } from "@/db";

// Holds a row until released, so the transactions started meanwhile queue
// behind it; `queued(n)` waits until n backends wait on it, directly or behind
// one that does. A fixed pause lost that race under full-suite load (12a).
export function holdRow(table: "item" | "user", id: string) {
  let rowHeld!: (pid: number) => void;
  let release!: () => void;
  const held = new Promise<number>((resolve) => (rowHeld = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const done = db.$transaction(
    async (tx) => {
      if (table === "item") {
        await tx.$queryRaw`SELECT id FROM item WHERE id = ${id} FOR UPDATE`;
      } else {
        await tx.$queryRaw`SELECT id FROM "user" WHERE id = ${id} FOR UPDATE`;
      }
      const [{ pid }] = await tx.$queryRaw<
        { pid: number }[]
      >`SELECT pg_backend_pid() AS pid`;
      rowHeld(pid);
      await released;
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
  async function queued(count: number) {
    const pid = await held;
    await vi.waitFor(
      async () => {
        const [{ waiting }] = await db.$queryRaw<{ waiting: number }[]>`
          WITH RECURSIVE chain AS (
            SELECT a.pid FROM pg_stat_activity a
            WHERE ${pid}::int = ANY (pg_blocking_pids(a.pid))
            UNION
            SELECT a.pid FROM pg_stat_activity a
            JOIN chain c ON c.pid = ANY (pg_blocking_pids(a.pid))
          )
          SELECT count(*)::int AS waiting FROM chain`;
        expect(waiting).toBeGreaterThanOrEqual(count);
      },
      { timeout: 15_000, interval: 50 },
    );
  }
  return { held, queued, release, done };
}
