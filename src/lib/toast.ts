import type { FlashKey } from "@/strings";

export const FLASH_COOKIE = "flash";
export const FLASH_MAX_AGE_SECONDS = 60;

export type ActiveToast = { key: FlashKey; id: number };

let active: ActiveToast | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeToToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getActiveToast(): ActiveToast | null {
  return active;
}

export function showToast(key: FlashKey): void {
  active = { key, id: nextId++ };
  emit();
}

export function dismissToast(id?: number): void {
  if (active === null || (id !== undefined && active.id !== id)) return;
  active = null;
  emit();
}
