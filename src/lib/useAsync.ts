import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T; refreshing: boolean }
  | { status: "error"; message: string };

/**
 * Loads data for `key`, showing loading only when the key changes. Background
 * refreshes keep the current data on screen, and a failed refresh keeps it too.
 */
export const useAsync = <T>(
  key: string,
  load: () => Promise<T>,
  refreshMs?: number,
): { state: AsyncState<T>; reload: () => void } => {
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

  useEffect(() => {
    run(false);
    if (!refreshMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") run(true);
    }, refreshMs);
    return () => window.clearInterval(timer);
  }, [key, refreshMs, run]);

  return { state, reload: () => run(false) };
};
