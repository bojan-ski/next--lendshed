import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  void request;
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

// Build assets are skipped: not indexable, and each proxy call costs free-tier budget.
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
