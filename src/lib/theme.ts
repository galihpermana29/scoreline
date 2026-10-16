import { useSyncExternalStore } from "react";

/**
 * Appearance store. Light is the default; a chosen theme is remembered per
 * browser. The attribute on <html> is what the stylesheet keys off, and
 * index.html sets it before first paint from the same storage key so a dark
 * session never flashes light on load.
 */
export type Theme = "dark" | "light";

const STORAGE_KEY = "scoreline:theme";
const DEFAULT_THEME: Theme = "light";
const META_COLOR: Record<Theme, string> = { dark: "#000000", light: "#ffffff" };

const isTheme = (value: unknown): value is Theme => value === "dark" || value === "light";

const readStored = (): Theme => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode quotas); fall through.
  }
  return DEFAULT_THEME;
};

const apply = (theme: Theme) => {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", META_COLOR[theme]);
};

let current: Theme = typeof document === "undefined" ? DEFAULT_THEME : readStored();
const listeners = new Set<() => void>();

if (typeof document !== "undefined") apply(current);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => current;

/** Swap the theme; the swap itself is a document-level crossfade where the browser supports it. */
export const setTheme = (theme: Theme) => {
  if (theme === current) return;
  const commit = () => {
    current = theme;
    apply(theme);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Not persisting is fine; the session still switches.
    }
    listeners.forEach((listener) => listener());
  };
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && typeof document.startViewTransition === "function") document.startViewTransition(commit);
  else commit();
};

export const toggleTheme = () => setTheme(current === "dark" ? "light" : "dark");

export const useTheme = (): Theme => useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_THEME);
