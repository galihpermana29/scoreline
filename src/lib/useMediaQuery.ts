import { useSyncExternalStore } from "react";

export const useMediaQuery = (query: string): boolean =>
  useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );

export const DESKTOP_QUERY = "(min-width: 900px)";

/**
 * Tablet, desktop, and TV. The same split as App's phone query
 * `(max-width: 739px)` and the `min-width: 740px` rules in the stylesheets.
 */
export const TABLET_UP_QUERY = "(min-width: 740px)";
