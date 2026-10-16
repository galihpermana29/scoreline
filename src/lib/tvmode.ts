import { useSyncExternalStore } from "react";

/**
 * TV Mode store (2026-10-17). A per-browser preference for driving the app
 * with a D-pad remote instead of a pointer, born from the TVBro session: a
 * TV browser converts the remote into a mouse cursor, and presses into
 * real keydown events, so the app can meet it halfway -
 *
 * - the mouse cursor is never drawn over our chrome (`cursor: none`),
 * - the focus ring is boosted so the D-pad position reads from the sofa,
 * - and the spatial navigation (lib/tvnav.ts) is mounted app-wide, since
 *   the remote works the sidebar and the browse surface, not just the watch
 *   screen.
 *
 * The stream embed is deliberately untouched: it is cross-origin, so its
 * own cursor, player chrome and click-to-play behave exactly as the source
 * ships them - swipe over the video and the cursor lives there, as before.
 */
export type TvMode = "on" | "off";

const STORAGE_KEY = "scoreline:tv-mode";
const DEFAULT_MODE: TvMode = "off";

const isTvMode = (value: unknown): value is TvMode => value === "on" || value === "off";

const readStored = (): TvMode => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isTvMode(stored)) return stored;
  } catch {
    // Storage can be unavailable (private mode quotas); fall through.
  }
  return DEFAULT_MODE;
};

const apply = (mode: TvMode) => {
  document.documentElement.dataset.tv = mode;
};

let current: TvMode = typeof document === "undefined" ? DEFAULT_MODE : readStored();
const listeners = new Set<() => void>();

if (typeof document !== "undefined") apply(current);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => current;

export const setTvMode = (mode: TvMode) => {
  if (mode === current) return;
  current = mode;
  apply(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not persisting is fine; the session still switches.
  }
  listeners.forEach((listener) => listener());
};

export const toggleTvMode = () => setTvMode(current === "on" ? "off" : "on");

export const useTvMode = (): TvMode => useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_MODE);