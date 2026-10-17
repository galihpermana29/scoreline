import { useConvexAuth } from "convex/react";
import type { ReactNode } from "react";

/**
 * Mounts its children only for a signed-in viewer. It is the watch screen's
 * door: the stream embed behind the gate never mounts, so nothing streams
 * (or costs anything) until the viewer is in. Reading the auth state here,
 * and not in the screen itself, keeps a session refresh from re-rendering
 * the stream: `children` keeps its identity, so React bails out below this.
 */
export const RequireAuth = ({ fallback, children }: { fallback: ReactNode; children: ReactNode }) => {
  const { isAuthenticated } = useConvexAuth();
  return isAuthenticated ? children : fallback;
};
