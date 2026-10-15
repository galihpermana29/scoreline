import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const RESOLVE_ENDPOINT = "/api/resolve-redirect";

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

export default defineConfig({
  plugins: [react(), resolveRedirectPlugin()],
  server: { port: 5188, strictPort: true },
});
