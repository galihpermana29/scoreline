import { useEffect, useRef, useState } from "react";
import { cachedNoAdMirrorOrigins, resolveNoAdMirrorOrigins } from "../api/source-sites";

/**
 * Mirror origins whose banner config is empty, for the page embed's Ads guard.
 *
 * Same shape as usePlayerHosts: the cached list paints immediately, then a
 * background resolve refreshes it. `reload(true)` re-reads params, which is
 * what a stalled embed uses. An empty list is a resolved answer, so the
 * initial `resolving` flag is only set when this browser has no cache yet -
 * otherwise a cold watch would treat "not loaded" as "no quiet mirror".
 */
export const useNoAdMirrors = (): {
  origins: readonly string[];
  resolving: boolean;
  reload: (fresh?: boolean) => Promise<readonly string[]>;
} => {
  const [origins, setOrigins] = useState<readonly string[]>(() => cachedNoAdMirrorOrigins() ?? []);
  const [resolving, setResolving] = useState(() => cachedNoAdMirrorOrigins() === null);
  const generation = useRef(0);

  const reload = (fresh = false): Promise<readonly string[]> => {
    const current = ++generation.current;
    setResolving(true);
    return resolveNoAdMirrorOrigins(fresh)
      .then((resolved) => {
        if (current === generation.current) setOrigins(resolved);
        return resolved;
      })
      .finally(() => {
        if (current === generation.current) setResolving(false);
      });
  };

  useEffect(() => {
    void reload();
    // Once per screen lifetime; a fresh read goes through `reload`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { origins, resolving, reload };
};
