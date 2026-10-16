import { useEffect, useRef, useState } from "react";
import { cachedPlayerHosts, resolvePlayerHosts } from "../api/source-sites";

/**
 * The live bare-player host list for the watch screen's direct player embed.
 *
 * Mirrors useEntryOrigin: starts instantly from the cached list so there is
 * never a blank state, then re-resolves in the background; `reload` with `fresh: true` bypasses every cache for the
 * stall-recovery path, when the listed hosts look dead and the params API
 * has to be re-read from scratch. The resolving flag is exposed for status
 * hints, not gating - the embed mounts against the last known host either
 * way, and the watchdog decides whether that host actually answered.
 */
export const usePlayerHosts = (): {
  hosts: readonly string[];
  resolving: boolean;
  reload: (fresh?: boolean) => Promise<readonly string[]>;
} => {
  const [hosts, setHosts] = useState<readonly string[]>(() => cachedPlayerHosts() ?? []);
  const [resolving, setResolving] = useState(false);
  const generation = useRef(0);

  const reload = (fresh = false): Promise<readonly string[]> => {
    const current = ++generation.current;
    setResolving(true);
    return resolvePlayerHosts(fresh).then(
      (resolved) => {
        if (current === generation.current) setHosts(resolved);
        return resolved;
      },
      (error: unknown) => {
        // resolvePlayerHosts never throws by contract; kept as a hard guard.
        if (current === generation.current) setResolving(false);
        throw error;
      },
    ).finally(() => {
      if (current === generation.current) setResolving(false);
    });
  };

  useEffect(() => {
    void reload();
    // Runs once for this screen's lifetime; key changes remount instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { hosts, resolving, reload };
};
