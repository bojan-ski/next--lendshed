import { PATH_HEADER } from "@/lib/auth/safe-next";

// An in-memory stand-in for `next/headers`. Test files mock the module with:
//   vi.mock("next/headers", async () =>
//     (await import("@/__tests__/support/next-request")).nextHeadersModule)
// Values are stored decoded and sent URL-encoded, as Next's own cookie store does.

type RequestOptions = {
  cookies?: Record<string, string>;
  ip?: string;
  path?: string;
  userAgent?: string;
};

const jar = new Map<string, string>();
let baseHeaders = new Headers();

export function mockNextRequest({
  cookies = {},
  ip,
  path,
  userAgent = "vitest",
}: RequestOptions = {}) {
  jar.clear();
  for (const [name, value] of Object.entries(cookies)) jar.set(name, value);
  baseHeaders = new Headers({ "user-agent": userAgent });
  if (ip) baseHeaders.set("x-forwarded-for", ip);
  if (path) baseHeaders.set(PATH_HEADER, path);
}

export function readCookie(name: string): string | undefined {
  return jar.get(name);
}

export function cookieNames(): string[] {
  return [...jar.keys()];
}

const cookieStore = {
  get: (name: string) =>
    jar.has(name) ? { name, value: jar.get(name)! } : undefined,
  getAll: () => [...jar].map(([name, value]) => ({ name, value })),
  has: (name: string) => jar.has(name),
  set: (name: string, value: string, options?: { maxAge?: number }) => {
    if (options?.maxAge === 0) jar.delete(name);
    else jar.set(name, value);
  },
  delete: (name: string) => jar.delete(name),
};

export const nextHeadersModule = {
  cookies: async () => cookieStore,
  headers: async () => {
    const headers = new Headers(baseHeaders);
    if (jar.size > 0) {
      headers.set(
        "cookie",
        [...jar]
          .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
          .join("; "),
      );
    }
    return headers;
  },
};
