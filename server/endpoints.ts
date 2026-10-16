/**
 * The single implementation of the three same-origin endpoints the client
 * depends on: /api/config, /api/probe-player and /api/resolve-redirect.
 *
 * In dev they are served by the Vite middlewares in vite.config.ts; in
 * production by thin Vercel Edge functions in api/. Both delegate here, so
 * the two surfaces cannot drift. Everything below uses only Web APIs
 * (Request/Response/fetch) so it runs in both runtimes.
 *
 * The source-network hosts live only in environment variables (gitignored
 * `.env` locally, hosting-provider settings in production). They are served
 * to the client through /api/config and are never compiled into anything
 * the browser ships.
 */

const MAX_HOPS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The operator's hosts sit behind Cloudflare and answer best to browser-like
 * clients (the API/CDN hosts 403 non-browser ones outright), so the resolver
 * identifies as a normal desktop browser.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

type Env = Record<string, string | undefined>;

/** Reads `process.env` without importing Node types (Edge runtime has it too). */
const processEnv = (): Env =>
  (globalThis as { process?: { env: Env } }).process?.env ?? {};

const envList = (name: string, env?: Env): string[] =>
  ((env ?? processEnv())[name] ?? "")
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host !== "");

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      // Mirrors rotate and 301s can be long-lived at the edge; never cache the answer.
      "cache-control": "no-store",
    },
  });

const badRequest = (message: string): Response => jsonResponse({ message }, 400);

/** Basic SSRF guard: only public http(s) hosts may be probed. */
const isProbeable = (url: URL): boolean => {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return !/^(f[cd])/i.test(host.replace(/[^0-9a-f]/gi, ""));
};

/**
 * GET /api/config - the env-seeded host lists. Without it (or with the vars
 * unset) the client runs discovery-only on top of its localStorage caches.
 */
export const configEndpoint = (env?: Env): Response =>
  jsonResponse({
    entryHosts: envList("SCORELINE_ENTRY_HOSTS", env),
    redirectingEntryHosts: envList("SCORELINE_REDIRECTING_ENTRY_HOSTS", env),
    apiHosts: envList("SCORELINE_API_HOSTS", env),
    playerHosts: envList("SCORELINE_PLAYER_HOSTS", env),
  });

/**
 * GET /api/probe-player?url=<https url> - requests a player embed URL exactly
 * as the browser's iframe navigation will (the app's own Referer plus real
 * Sec-Fetch metadata) and reports the HTTP status the host answered with, so
 * the watch screen can tell a healthy player from a 401 text page before
 * mounting it. 200 with {url, status, ok}; 502 when the transport failed.
 */
export const probePlayerEndpoint = async (request: Request): Promise<Response> => {
  const input = new URL(request.url).searchParams.get("url");
  if (input === null || input === "") return badRequest("Missing url parameter.");

  let target: URL;
  try {
    target = new URL(input);
  } catch {
    return badRequest("url parameter is not a valid absolute URL.");
  }
  if (!isProbeable(target)) return badRequest("Only public http(s) URLs can be probed.");

  // The Referer the real iframe navigation will carry: this app's own origin,
  // as the request reached the endpoint.
  const referer = `${new URL(request.url).origin}/`;

  try {
    const response = await fetch(target.href, {
      redirect: "follow",
      headers: {
        "user-agent": BROWSER_UA,
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en",
        referer,
        "sec-fetch-dest": "iframe",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "cross-site",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    // Free the socket; only the status line matters.
    await response.body?.cancel().catch(() => undefined);
    return jsonResponse({ url: response.url, status: response.status, ok: response.ok });
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `Timed out after ${REQUEST_TIMEOUT_MS} ms while probing ${target.href}.`
        : error instanceof Error
          ? error.message
          : "Player probe failed.";
    return jsonResponse({ message }, 502);
  }
};

/**
 * GET /api/resolve-redirect?url=<http(s) url> - walks a URL's server-side
 * redirect chain one hop at a time (fetch redirect: "manual") and returns the
 * full hop list. The browser cannot do this itself: cross-origin redirect
 * destinations are hidden from page JS by design. 200 with
 * {input, hops, finalUrl, redirected}; 508 when the chain loops.
 */
export const resolveRedirectEndpoint = async (request: Request): Promise<Response> => {
  const input = new URL(request.url).searchParams.get("url");
  if (input === null || input === "") return badRequest("Missing url parameter.");

  let start: URL;
  try {
    start = new URL(input);
  } catch {
    return badRequest("url parameter is not a valid absolute URL.");
  }
  if (!isProbeable(start)) return badRequest("Only public http(s) URLs can be resolved.");

  const hops: { url: string; status: number; location: string | null }[] = [];
  let current = start.href;

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      const response = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": BROWSER_UA, "accept-language": "en" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const location = response.headers.get("location");
      hops.push({ url: current, status: response.status, location });
      // Free the socket; the body is never needed.
      await response.body?.cancel().catch(() => undefined);

      const isRedirect = response.status >= 300 && response.status < 400;
      if (!isRedirect || location === null) {
        return jsonResponse({ input: start.href, hops, finalUrl: current, redirected: hops.length > 1 });
      }
      current = new URL(location, current).href; // handle relative Locations
    }
    return jsonResponse({ message: `More than ${MAX_HOPS} redirects; the chain looks looped.` }, 508);
  } catch (error: unknown) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? `Timed out after ${REQUEST_TIMEOUT_MS} ms while probing ${current}.`
        : error instanceof Error
          ? error.message
          : "Redirect resolution failed.";
    return jsonResponse({ message }, 502);
  }
};
