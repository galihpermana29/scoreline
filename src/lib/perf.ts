import { useSyncExternalStore } from "react";

/**
 * A performance mode the visitor chooses per browser - "light" for weak
 * hardware (smart TVs, 1GB Android WebView boxes) where two-hour watch
 * sessions degrade the whole page, "normal" everywhere else. It is a
 * resource-budget switch, not a redesign: light trims continuous
 * compositing work and background network chatter while keeping the
 * identical layout and controls (2026-10-17, after a TV session measured
 * hour-two UI latency of ~1.5s per click: the browse surface under the
 * watch layer keeps re-rendering every feed poll and every backdrop blur
 * re-composites every frame, and TV browsers run it all in one process).
 *
 * What light mode changes, all at once (see App.tsx / watch.css):
 * - The feed polls stop while a stream is playing: scores are stale
 *   through a watch session in exchange for zero background requests and
 *   zero re-renders of the (inert) browse surface; stopping the embed or
 *   leaving the screen refreshes in the background.
 * - The browse surface unmounts entirely under the watch layer, freeing
 *   its DOM and decoded images while the visitor watches.
 * - Every backdrop blur is dropped (they cost per-frame on weak GPUs) and
 * - Motion animations collapse to opacity-only (MotionConfig
 *   reducedMotion="always").
 * The stream embed itself is untouched: the source's page is the source's
 * page, in both modes.
 */

export type PerfMode = "normal" | "light";

const KEY = "scoreline:perf-mode";

const readStored = (): PerfMode => {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "normal";
  } catch {
    // Private mode or storage disabled: the preference just does not persist.
    return "normal";
  }
};

let current: PerfMode = readStored();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

const notify = () => {
  for (const listener of listeners) listener();
};

/** The mode right now, for non-React readers. */
export const readPerfMode = (): PerfMode => current;

export const setPerfMode = (mode: PerfMode) => {
  if (mode === current) return;
  current = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Private mode: this session only.
  }
  notify();
};

/**
 * The mode plus its setter, as one hook. `useSyncExternalStore` keeps both
 * my call sites (App's polling/render policy and the watch toolbar's
 * switcher) on the same single source of truth, so a flip in one is seen by
 * the other on the same tick.
 */
export const usePerfMode = (): [PerfMode, (mode: PerfMode) => void] => [
  useSyncExternalStore(subscribe, () => current),
  setPerfMode,
];