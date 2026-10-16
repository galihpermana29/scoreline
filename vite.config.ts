import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const RESOLVE_ENDPOINT = "/api/resolve-redirect";
const PROBE_ENDPOINT = "/api/probe-player";

const MAX_HOPS = 5;
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * The operator's hosts sit behind Cloudflare and answer best to browser-like
 * clients (the API/CDN hosts 403 non-browser ones outright), so the resolver
 * identifies as a normal desktop browser.
 */
const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";

/** Basic SSRF guard: only public http(s) hosts may be probed. */
const isProbeable = (url: URL): boolean => {
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "::1" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (/^(127\.|0\.|10\.|192\.168\.|169\.254\.)/.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  return !/^(f[cd])/i.test(host.replace(/[^0-9a-f]/gi, ""));
};

const sendJson = (res: object, status: number, body: unknown): void => {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  // Mirrors rotate and 301s can be long-lived at the edge; never cache the answer.
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
};

/**
 * Dev-server endpoint GET /api/resolve-redirect?url=<http(s) url> that walks a
 * URL's server-side redirect chain one hop at a time (fetch redirect: "manual")
 * and returns the full hop list. The browser cannot do this itself: cross-origin
 * redirect destinations are hidden from page JS by design (Performance
 * Navigation zeroes them, cross-origin fetches are opaque or CORS-blocked).
 * Served by Vite in dev only; production needs a real endpoint with the same
 * request/response shape.
 */
const resolveRedirectPlugin = (): Plugin => ({
  name: "resolve-redirect",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== "GET" || !req.url?.startsWith(RESOLVE_ENDPOINT)) {
        next();
        return;
      }

      const input = new URL(req.url, "http://localhost").searchParams.get("url");
      if (input === null || input === "") {
        sendJson(res, 400, { message: "Missing url parameter." });
        return;
      }

      let start: URL;
      try {
        start = new URL(input);
      } catch {
        sendJson(res, 400, { message: "url parameter is not a valid absolute URL." });
        return;
      }
      if (!isProbeable(start)) {
        sendJson(res, 400, { message: "Only public http(s) URLs can be resolved." });
        return;
      }

      const hops: { url: string; status: number; location: string | null }[] = [];
      let current = start.href;

      const walk = async (): Promise<void> => {
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
            sendJson(res, 200, { input: start.href, hops, finalUrl: current, redirected: hops.length > 1 });
            return;
          }
          current = new URL(location, current).href; // handle relative Locations
        }
        sendJson(res, 508, { message: `More than ${MAX_HOPS} redirects; the chain looks looped.` });
      };

      walk().catch((error: unknown) => {
        const message =
          error instanceof Error && error.name === "TimeoutError"
            ? `Timed out after ${REQUEST_TIMEOUT_MS} ms while probing ${current}.`
            : error instanceof Error
              ? error.message
              : "Redirect resolution failed.";
        sendJson(res, 502, { message });
      });
    });
  },
});

/**
 * Dev-server endpoint GET /api/probe-player?url=<https url> that requests a
 * player embed URL exactly as the browser's iframe navigation will - the
 * app's own Referer plus real Sec-Fetch metadata - and reports the HTTP
 * status the host answered with. The player gate was verified live
 * (2026-10-16) to be Referer-based (401 with no Referer, 200 with any
 * Referer), and it answers a server-side fetch identically, so this
 * reproduces what the frame will see without mounting it: a 401 here is a
 * 401 there. Same dev-only story as resolve-redirect above; in production
 * it has to be a real endpoint returning the same shape.
 */
const probePlayerPlugin = (): Plugin => ({
  name: "probe-player",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.method !== "GET" || !req.url?.startsWith(PROBE_ENDPOINT)) {
        next();
        return;
      }

      const input = new URL(req.url, "http://localhost").searchParams.get("url");
      if (input === null || input === "") {
        sendJson(res, 400, { message: "Missing url parameter." });
        return;
      }

      let target: URL;
      try {
        target = new URL(input);
      } catch {
        sendJson(res, 400, { message: "url parameter is not a valid absolute URL." });
        return;
      }
      if (!isProbeable(target)) {
        sendJson(res, 400, { message: "Only public http(s) URLs can be probed." });
        return;
      }

      // The Referer the real iframe navigation will carry: this app's own
      // origin, as the request reached the dev server.
      const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
      const hostHeader = (req.headers.host as string | undefined) ?? "localhost:5188";
      const referer = `${proto}://${hostHeader}/`;

      fetch(target.href, {
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
      })
        .then(async (response) => {
          // Free the socket; only the status line matters.
          await response.body?.cancel().catch(() => undefined);
          sendJson(res, 200, { url: response.url, status: response.status, ok: response.ok });
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error && error.name === "TimeoutError"
              ? `Timed out after ${REQUEST_TIMEOUT_MS} ms while probing ${target.href}.`
              : error instanceof Error
                ? error.message
                : "Player probe failed.";
          sendJson(res, 502, { message });
        });
    });
  },
});

export default defineConfig({
  plugins: [react(), resolveRedirectPlugin(), probePlayerPlugin()],
  server: { port: 5188, strictPort: true },
});
