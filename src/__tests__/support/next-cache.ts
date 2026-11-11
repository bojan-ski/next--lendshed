// A stand-in for `next/cache`: the real cacheTag/cacheLife throw outside Next's
// runtime, and updateTag outside a Server Action. Test files mock the module with:
//   vi.mock("next/cache", async () =>
//     (await import("@/__tests__/support/next-cache")).nextCacheModule)
// Under Vitest `'use cache'` is an inert string, so cached reads query every time.
export const nextCacheModule = {
  refresh: vi.fn(),
  updateTag: vi.fn(),
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
};
