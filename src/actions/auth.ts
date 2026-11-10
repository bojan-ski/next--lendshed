"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth/auth";
import { requireViewer } from "@/lib/auth/guards";
import { copySetCookies, forwardSignIn } from "@/lib/auth/sign-in";
import { signInSchema } from "@/lib/schemas/auth";
import type { SignInState } from "@/types/auth";

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

export async function signOut(): Promise<void> {
  await requireViewer();
  const { headers: responseHeaders } = await auth.api.signOut({
    headers: await headers(),
    returnHeaders: true,
  });
  await copySetCookies(responseHeaders);
  redirect("/login");
}
