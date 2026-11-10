"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Icon } from "@/components/ui/icons";
import { publicEnv } from "@/lib/env/public";
import {
  type ActiveToast,
  FLASH_COOKIE,
  dismissToast,
  getActiveToast,
  showToast,
  subscribeToToasts,
} from "@/lib/feedback/toast";
import { t } from "@/lib/text/interpolate";
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
  try {
    return decodeURIComponent(entry.slice(prefix.length));
  } catch {
    return null; // a malformed value is dropped, never thrown into the shell
  }
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

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex justify-center sm:inset-x-auto sm:right-6 sm:bottom-6"
    >
      {toast !== null && <ToastCard key={toast.id} toast={toast} />}
    </div>
  );
}

// Keyed by toast id, so a new toast starts unpaused with a fresh timer.
// Hover or focus inside pauses the auto-dismiss; leaving restarts the full 5 s.
function ToastCard({ toast }: { toast: ActiveToast }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const paused = hovered || focused;
  // Where keyboard focus came from, so closing doesn't drop it to <body>.
  const cameFrom = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => dismissToast(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [paused, toast.id]);

  function close() {
    const target = cameFrom.current ?? document.getElementById("main");
    dismissToast(toast.id);
    target?.focus();
  }

  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={(event) => {
        setFocused(true);
        const from = event.relatedTarget;
        if (
          from instanceof HTMLElement &&
          !event.currentTarget.contains(from)
        ) {
          cameFrom.current = from;
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false);
      }}
      className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-card border border-line bg-card py-1 pr-1 pl-4 text-ink motion-safe:transition-opacity motion-safe:duration-200 motion-safe:starting:opacity-0"
    >
      <Icon name="check" aria-hidden className="shrink-0 text-accent" />
      <p className="flex-1">
        {t(flash[toast.key], { appName: publicEnv.NEXT_PUBLIC_APP_NAME })}
      </p>
      <button
        type="button"
        onClick={close}
        aria-label={toastStrings.close}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-control"
      >
        <Icon name="close" aria-hidden />
      </button>
    </div>
  );
}
