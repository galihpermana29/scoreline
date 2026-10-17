/**
 * Client for the player prober (see the plugin in vite.config.ts).
 *
 * Why a prober exists at all: a cross-origin iframe fires its load event for
 * a 401 text page exactly as happily as for the real player, so the watch
 * screen cannot tell a refused embed from a healthy one - a tightened gate
 * or a dead player host would look like a working player right up until the
 * user stares at a blank frame. The browser also cannot ask itself: page
 * JavaScript is not allowed to set Sec-Fetch-Dest (a forbidden header), so
 * no client-side fetch can reproduce the iframe navigation the gate checks.
 * So the exact embed URL is requested outside the browser, with the app's
 * own Referer and real iframe Sec-Fetch metadata, and the answer is exposed
 * same-origin at /api/probe-player. In dev that endpoint is the Vite
 * middleware; in production it has to be a real endpoint (server route or
 * function) returning the same shape - until then this degrades to "unknown"
 * and the embed trusts the load watchdog alone.
 */

export type PlayerProbe =
  | { kind: "reachable"; status: number; finalUrl: string | null }
  | { kind: "refused"; status: number }
  | { kind: "unreachable"; status: number }
  | { kind: "unknown" };

/**
 * Probes one player embed URL and classifies the answer. Only definitive
 * signals are acted on: a 2xx is reachable, a 401/403 means the gate
 * refused, anything else the host answered with means it is not serving the
 * page. A missing endpoint (404 - e.g. a static production build) or a
 * failed probe is "unknown", which callers must treat as "no evidence" and
 * fall back to their normal behaviour, never as a failure.
 */
export const probePlayerUrl = async (url: string): Promise<PlayerProbe> => {
  try {
    const response = await fetch(`/api/probe-player?url=${encodeURIComponent(url)}`);
    if (response.status === 404) {
      // The endpoint is not deployed: no evidence either way.
      return { kind: "unknown" };
    }
    if (!response.ok) {
      // 502: the prober tried and the transport failed, so the host is as
      // unreachable from this machine as the iframe would find it.
      return response.status === 502 ? { kind: "unreachable", status: 502 } : { kind: "unknown" };
    }
    const body = (await response.json().catch(() => null)) as Partial<{ status: number; url: string }> | null;
    if (body === null || typeof body.status !== "number") {
      return { kind: "unknown" };
    }
    if (body.status >= 200 && body.status < 300) {
      return { kind: "reachable", status: body.status, finalUrl: typeof body.url === "string" ? body.url : null };
    }
    if (body.status === 401 || body.status === 403) return { kind: "refused", status: body.status };
    return { kind: "unreachable", status: body.status };
  } catch {
    return { kind: "unknown" };
  }
};
