const DUMMY_ORIGIN = "http://lendshed.invalid";

// Set by the proxy on every pass-through (pathname + search), overwriting any client value.
export const PATH_HEADER = "x-lendshed-path";

function hasUnsafeCharacter(value: string): boolean {
  return [...value].some((char) => {
    const code = char.charCodeAt(0);
    return char === "\\" || /\s/.test(char) || code < 0x20 || code === 0x7f;
  });
}

// The only return-to rule: an internal path, never /login or /api, else "/".
// Client-safe and DB-free, so the proxy and ViewerGate agree with signIn.
export function safeNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (hasUnsafeCharacter(value)) return "/";

  let url: URL;
  try {
    url = new URL(value, DUMMY_ORIGIN);
  } catch {
    return "/";
  }
  if (url.origin !== DUMMY_ORIGIN) return "/";

  const { pathname } = url;
  if (
    pathname.startsWith("//") ||
    pathname === "/login" ||
    pathname.startsWith("/login/") ||
    pathname.startsWith("/api/")
  ) {
    return "/";
  }
  return pathname + url.search + url.hash;
}
