import type { db as Db } from "@/db";

// App-wide sums and the daily job's app-wide writes can't be scoped to a
// test's rows. One REPEATABLE READ snapshot sees only this test's writes, so a
// before/after difference is exact; it is rolled back, leaving no rows.
//
// Per test file:
//   vi.mock("@/db", async (importOriginal) =>
//     (await import("@/__tests__/support/snapshot")).snapshotDbModule(
//       await importOriginal<typeof import("@/db")>(),
//     ),
//   );
// While a snapshot is open, `db` (in the test, the scope and the code under
// test) is that transaction's client. No static `@/db` import here: the mock
// factory loads this module, and that import would re-enter the mock.
const state: { base: typeof Db | null; tx: object | null } = {
  base: null,
  tx: null,
};

export function snapshotDbModule(original: { db: typeof Db }) {
  state.base = original.db;
  return {
    ...original,
    db: new Proxy(original.db, {
      get(target, key) {
        const source = (state.tx ?? target) as Record<PropertyKey, unknown>;
        const value = source[key];
        return typeof value === "function" ? value.bind(source) : value;
      },
    }),
  };
}

const ROLLBACK = Symbol("rollback");

export async function inOneSnapshot<T>(run: () => Promise<T>): Promise<T> {
  const base = state.base;
  if (!base) throw new Error("mock @/db with snapshotDbModule first");
  let result: T | undefined;
  try {
    await base.$transaction(
      async (tx) => {
        state.tx = tx;
        try {
          result = await run();
        } finally {
          state.tx = null;
        }
        throw ROLLBACK;
      },
      { isolationLevel: "RepeatableRead", maxWait: 15_000, timeout: 30_000 },
    );
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result as T;
}
