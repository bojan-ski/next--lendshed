import "server-only";
import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { cookies, headers } from "next/headers";
import { auth } from "@/lib/auth/auth";
import { env } from "@/lib/env/server";
import type { ChangePasswordError } from "@/types/account";
import type { SignInFormError } from "@/types/auth";

// Not a "use server" module: an export from one would become a public action.

type ForwardedHeader = "x-forwarded-for" | "user-agent" | "cookie";

// Calls go through the library's HTTP handler so its database rate limiter
// and its own rules apply unchanged.
async function postToLibrary(
  path: string,
  body: unknown,
  forward: readonly ForwardedHeader[],
): Promise<Response> {
  const incoming = await headers();
  const appUrl = new URL(env.APP_URL);
  const forwarded = new Headers({
    "content-type": "application/json",
    origin: appUrl.origin,
  });
  for (const name of forward) {
    const value = incoming.get(name);
    if (value) forwarded.set(name, value);
  }
  return auth.handler(
    new Request(new URL(`/api/auth${path}`, appUrl), {
      method: "POST",
      headers: forwarded,
      body: JSON.stringify(body),
    }),
  );
}

export async function forwardSignIn(
  email: string,
  password: string,
): Promise<SignInFormError | null> {
  let response: Response;
  try {
    response = await postToLibrary("/sign-in/email", { email, password }, [
      "x-forwarded-for",
      "user-agent",
    ]);
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

// The library deletes every session of the user (this one included) and
// issues the caller a new one, whose cookie is copied here.
export async function forwardChangePassword(
  currentPassword: string,
  newPassword: string,
): Promise<ChangePasswordError | null> {
  let response: Response;
  try {
    response = await postToLibrary(
      "/change-password",
      { currentPassword, newPassword, revokeOtherSessions: true },
      ["x-forwarded-for", "user-agent", "cookie"],
    );
  } catch {
    return "unexpected";
  }

  if (response.status === 200) {
    await copySetCookies(response.headers);
    return null;
  }
  if (response.status === 429) return "tooManyAttempts";
  if (
    response.status === 400 &&
    (await errorCode(response)) === "INVALID_PASSWORD"
  ) {
    return "invalidCurrentPassword";
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
