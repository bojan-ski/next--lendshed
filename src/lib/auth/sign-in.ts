import "server-only";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { env } from "@/lib/env/server";
import type { SignInFormError } from "@/types/auth";

// Not a "use server" module: an export from one would become a public action.

const FORWARDED_HEADERS = ["x-forwarded-for", "user-agent"] as const;

// Goes through the library's HTTP handler so its database rate limiter and
// sign-in rules apply unchanged.
export async function forwardSignIn(
  email: string,
  password: string,
): Promise<SignInFormError | null> {
  const incoming = await headers();
  const appUrl = new URL(env.APP_URL);
  const forwarded = new Headers({
    "content-type": "application/json",
    origin: appUrl.origin,
  });
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }

  let response: Response;
  try {
    response = await auth.handler(
      new Request(new URL("/api/auth/sign-in/email", appUrl), {
        method: "POST",
        headers: forwarded,
        body: JSON.stringify({ email, password }),
      }),
    );
  } catch {
    return "unexpected";
  }

  if (response.status === 200) {
    await copySetCookies(response.headers);
    return null;
  }
  if (response.status === 429) return "tooManyAttempts";

  const code = await errorCode(response);
  if (response.status === 401 && code === "INVALID_EMAIL_OR_PASSWORD") {
    return "invalidCredentials";
  }
  if (response.status === 403 && code === "ACCOUNT_SUSPENDED") {
    return "suspended";
  }
  return "unexpected";
}

async function errorCode(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => null);
  if (body && typeof body === "object" && "code" in body) {
    return typeof body.code === "string" ? body.code : undefined;
  }
  return undefined;
}

// nextCookies() skips calls that arrive through auth.handler, so the actions
// copy the library's cookies themselves (for signOut too, so the clearing
// never depends on the plugin; a second identical set is harmless).
export async function copySetCookies(responseHeaders: Headers): Promise<void> {
  const cookieStore = await cookies();
  for (const header of responseHeaders.getSetCookie()) {
    for (const [name, attributes] of parseSetCookieHeader(header)) {
      const { maxAge, path, httpOnly, sameSite, secure } =
        toCookieOptions(attributes);
      cookieStore.set(name, attributes.value, {
        maxAge,
        path,
        httpOnly,
        sameSite,
        secure,
      });
    }
  }
}
