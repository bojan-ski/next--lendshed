import "server-only";
import { cookies } from "next/headers";
import type { FlashKey } from "@/strings";
import { FLASH_COOKIE, FLASH_MAX_AGE_SECONDS } from "@/lib/toast";

// Not httpOnly: the Toaster reads and clears it in the browser.
export async function setFlash(key: FlashKey): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(FLASH_COOKIE, key, {
    maxAge: FLASH_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
  });
}
