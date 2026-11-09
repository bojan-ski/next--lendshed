"use server";

import { parseSetCookieHeader, toCookieOptions } from "better-auth/cookies";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { requireViewer } from "@/lib/auth-guards";
import { env } from "@/lib/env";
import { signInSchema } from "@/lib/schemas/auth";
import type { SignInFormError, SignInState } from "@/types/auth";

const FORWARDED_HEADERS = ["x-forwarded-for", "user-agent"] as const;

export async function signIn(
  _prev: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const rawEmail = formData.get("email");
  const parsed = signInSchema.safeParse({
    email: rawEmail,
    password: formData.get("password"),
    next: formData.get("next"),
  });
  if (!parsed.success) {
    const { fieldErrors } = z.flattenError(parsed.error);
    return {
      fieldErrors: { email: fieldErrors.email, password: fieldErrors.password },
      email: typeof rawEmail === "string" ? rawEmail : undefined,
    };
  }

  const { email, password, next } = parsed.data;
  const formError = await forwardSignIn(email, password);
  if (formError) return { formError, email };

  redirect(next);
}

// Goes through the library's HTTP handler so its database rate limiter and
// sign-in rules apply unchanged.
async function forwardSignIn(
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
async function copySetCookies(responseHeaders: Headers): Promise<void> {
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

export async function signOut(): Promise<void> {
  await requireViewer();
  const { headers: responseHeaders } = await auth.api.signOut({
    headers: await headers(),
    returnHeaders: true,
  });
  await copySetCookies(responseHeaders);
  redirect("/login");
}
