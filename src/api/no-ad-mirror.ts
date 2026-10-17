import { probePlayerUrl } from "./probe";
import { sourceUrl } from "../lib/route";

/**
 * Quiet page-embed selection (verified 2026-10-18).
 *
 * The entry page hands itself off to a mirror whose banner config is full.
 * Other brands in the same params tree have an empty `common:ad` object and
 * their own mirror origins under `g_player_domains`. Embedding the match
 * path on one of those origins skips the banners, and the stream and the
 * server row still belong to their page. The brand is whichever object is
 * empty, never a pinned name: filling the object, or dropping the origins,
 * removes the candidate on the next decode.
 *
 * A host that answers by redirecting onto a different origin is not quiet
 * anymore (a burn often 301s onto the ad-bearing mirror). The probe follows
 * redirects, so that candidate is skipped. The parent page cannot see the
 * framed document, which is why the redirect check is the signal we have.
 */

export type NoAdMirrorPick = { kind: "embed"; url: string } | { kind: "unavailable" };

const stayedOnOrigin = (finalUrl: string | null, origin: string): boolean => {
  if (finalUrl === null) return true;
  try {
    return new URL(finalUrl).origin === origin;
  } catch {
    return false;
  }
};

/**
 * The first listed origin whose match page answers 2xx without leaving that
 * origin. "unknown" (no prober deployed) embeds the first candidate: absence
 * of evidence is not failure, and the load watchdog still judges the frame.
 * Every candidate refused, redirected away, or unreachable: "unavailable",
 * and the caller mounts the entry page instead.
 */
export const pickNoAdMirrorUrl = async (
  origins: readonly string[],
  routePath: string,
): Promise<NoAdMirrorPick> => {
  for (const origin of origins) {
    const url = sourceUrl(routePath, origin);
    const probe = await probePlayerUrl(url);
    if (probe.kind === "unknown") return { kind: "embed", url };
    if (probe.kind === "reachable" && stayedOnOrigin(probe.finalUrl, origin)) return { kind: "embed", url };
  }
  return { kind: "unavailable" };
};
