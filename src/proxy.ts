import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER, safeNextPath } from "@/lib/auth/safe-next";

const SIGNED_OUT_PATHS = ["/login", "/house-rules", "/privacy"];
const SIGNED_OUT_PREFIXES = ["/invite/", "/reset/", "/api/auth/", "/api/cron/"];
// Token links: the token must not leave in a Referer header.
const NO_REFERRER_PREFIXES = ["/invite/", "/reset/"];

function isSignedOutPath(pathname: string): boolean {
  if (SIGNED_OUT_PATHS.includes(pathname)) return true;
  if (SIGNED_OUT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return true;
  }
  // Public files and metadata routes (/favicon.ico, /robots.txt).
  return (pathname.split("/").at(-1) ?? "").includes(".");
}

// Cookie presence only: no database, no validity check (the (app) layout does that).
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const response =
    isSignedOutPath(pathname) || getSessionCookie(request)
      ? passThrough(request, pathname + search)
      : redirectToLogin(request, pathname + search);
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  if (NO_REFERRER_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    response.headers.set("Referrer-Policy", "no-referrer");
  }
  return response;
}

function passThrough(request: NextRequest, path: string) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(PATH_HEADER, path);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function redirectToLogin(request: NextRequest, path: string) {
  const url = new URL("/login", request.url);
  url.searchParams.set("next", safeNextPath(path));
  return NextResponse.redirect(url, 307);
}

// Build assets are skipped: not indexable, and each proxy call costs free-tier budget.
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
