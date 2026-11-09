"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";
import {
  FLASH_COOKIE,
  dismissToast,
  getActiveToast,
  showToast,
  subscribeToToasts,
} from "@/lib/feedback/toast";
import type { FlashKey } from "@/strings";
import { flash } from "@/strings/flash";
import { toast as toastStrings } from "@/strings/toast";

const AUTO_DISMISS_MS = 5000;

function takeFlashCookie(): string | null {
  const prefix = `${FLASH_COOKIE}=`;
  const entry = document.cookie.split("; ").find((c) => c.startsWith(prefix));
  if (entry === undefined) return null;
  // Must match setFlash's path, or the browser keeps the cookie.
  document.cookie = `${FLASH_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
  return decodeURIComponent(entry.slice(prefix.length));
}

function isFlashKey(value: string): value is FlashKey {
  return Object.hasOwn(flash, value);
}

export default function Toaster() {
  const pathname = usePathname();
  const toast = useSyncExternalStore(
    subscribeToToasts,
    getActiveToast,
    () => null,
  );

  // Only a pathname change re-checks, so actions never redirect to their own page.
  useEffect(() => {
    const value = takeFlashCookie();
    if (value !== null && isFlashKey(value)) showToast(value);
  }, [pathname]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      {toast !== null && (
        <div
          key={toast.id}
          className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-card border border-line bg-card py-1 pr-1 pl-4 text-ink motion-safe:transition-opacity motion-safe:duration-200 motion-safe:starting:opacity-0"
        >
          <Icon name="check" aria-hidden className="shrink-0 text-accent" />
          <p className="flex-1">{flash[toast.key]}</p>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            aria-label={toastStrings.close}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-control"
          >
            <Icon name="close" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}
