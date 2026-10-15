import { useEffect, useRef, useState } from "react";
import { cachedEntryOrigin, DEFAULT_ENTRY_ORIGIN_FALLBACK, resolveEntryOrigin } from "../api/source-sites";

/**
 * The live entry origin for the watch screen's embed and route card.
 *
 * Starts instantly from the cached origin (or the compiled-in fallback) so
 * there is never a blank state, then re-resolves in the background; `reload`
 * with `fresh: true` bypasses every cache for the stall-recovery path, when
 * the current generation looks dead and the rotation has to be discovered
 * from scratch. The resolving flag is exposed for status hints, not gating -
 * the embed mounts against the last known origin either way.
 */
export const useEntryOrigin = (): {
  origin: string;
  resolving: boolean;
  reload: (fresh?: boolean) => Promise<string>;
} => {
  const [origin, setOrigin] = useState<string>(() => cachedEntryOrigin() ?? DEFAULT_ENTRY_ORIGIN_FALLBACK);
  const [resolving, setResolving] = useState(false);
  const generation = useRef(0);

  const reload = (fresh = false): Promise<string> => {
    const current = ++generation.current;
    setResolving(true);
    return resolveEntryOrigin(fresh).then(
      (resolved) => {
        if (current === generation.current) setOrigin(resolved);
        return resolved;
      },
      (error: unknown) => {
        // resolveEntryOrigin never throws by contract; kept as a hard guard.
        if (current === generation.current) setResolving(false);
        throw error;
      },
    ).finally(() => {
      if (current === generation.current) setResolving(false);
    });
  };

  useEffect(() => {
    void reload();
    // Reload reads the latest closure through a ref-free path on purpose:
    // it runs once for this screen's lifetime; key changes remount instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { origin, resolving, reload };
};
