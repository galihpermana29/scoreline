import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; refreshing: boolean }
  | { status: "error"; message: string };

/**
 * Loads data for `key`, showing loading only when the key changes. Background
 * refreshes keep the current data on screen, and a failed refresh keeps it too.
 *
 * `paused` stops the background refresh interval without touching the data:
 * a paused poller keeps serving its last snapshot until it is resumed, which
 * is what light mode wants while a stream is playing (2026-10-17) - no
 * background requests, no re-renders of the surface showing the data. Pause
 * does not gate the initial load: a first mount always fetches. Timing: the
 * interval only fires while the tab is visible, so hidden tabs never spend
 * the source's rate-limit budget either.
 */
export const useAsync = <T>(
  key: string,
  load: () => Promise<T>,
  refreshMs?: number,
  paused = false,
): { state: AsyncState<T>; reload: () => void; refresh: () => void } => {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const loadRef = useRef(load);
  loadRef.current = load;
  const generation = useRef(0);

  const run = useCallback((background: boolean) => {
    const current = ++generation.current;
    setState((previous) =>
      background && previous.status === "ready" ? { ...previous, refreshing: true } : { status: "loading" },
    );
    loadRef.current().then(
      (data) => {
        if (current === generation.current) setState({ status: "ready", data, refreshing: false });
      },
      (error: unknown) => {
        if (current !== generation.current) return;
        const message = error instanceof Error ? error.message : "Something went wrong.";
        setState((previous) =>
          background && previous.status === "ready" ? { ...previous, refreshing: false } : { status: "error", message },
        );
      },
    );
  }, []);

  // The initial load reacts to the key only; the interval below reacts to
  // the pause gate. Splitting them means pausing never refires the initial
  // load (which would hurl ready data back to a skeleton mid-watch).
  useEffect(() => {
    run(false);
  }, [key, run]);

  useEffect(() => {
    if (!refreshMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !paused) run(true);
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [refreshMs, paused, run]);

  // The paused gate rides its own effect so pausing never refires the
  // initial load and never resets ready data to a skeleton. It fires only
  // on the paused -> resumed transition (the first mount included: there
  // is nothing stale to catch up on yet), immediately refreshing in the
  // background so a long pause does not show old data for a full interval.
  const wasPaused = useRef<boolean | null>(null);
  useEffect(() => {
    const previous = wasPaused.current;
    wasPaused.current = paused;
    if (paused || !refreshMs || previous !== true) return;
    run(true);
  }, [paused, refreshMs, run]);

  return { state, reload: () => run(false), refresh: () => run(true) };
};