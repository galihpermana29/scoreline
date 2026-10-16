import { defineConfig, loadEnv, type Plugin } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { configEndpoint, probePlayerEndpoint, resolveRedirectEndpoint } from "./server/endpoints";

const RESOLVE_ENDPOINT = "/api/resolve-redirect";
const PROBE_ENDPOINT = "/api/probe-player";
const CONFIG_ENDPOINT = "/api/config";

/**
 * The three same-origin endpoints (config, probe-player, resolve-redirect)
 * have one implementation in server/endpoints.ts; in production the thin
 * Edge functions in api/ delegate to it too, so dev and prod cannot drift.
 *
 * The host lists themselves live only in `.env` (gitignored) and are served
 * to the app through /api/config, so they are compiled into nothing the
 * client ships: the JS bundle never contains a hostname, and a fresh clone
 * contains none either. Without the env vars the client runs discovery-only
 * on top of its localStorage caches.
 */

const matchesEndpoint = (req: IncomingMessage, endpoint: string): boolean =>
  req.method === "GET" && (req.url?.startsWith(endpoint) ?? false);

/** Builds a full Request from the middleware call, keeping the real host. */
const requestFrom = (req: IncomingMessage): Request => {
  const proto = (req.headers["x-forwarded-proto"] as string | undefined) ?? "http";
  const host = (req.headers.host as string | undefined) ?? "localhost";
  return new Request(`${proto}://${host}${req.url ?? "/"}`);
};

/** Copies a Response onto the Node-style response the middleware gets. */
const respond = async (res: ServerResponse, response: Response): Promise<void> => {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(await response.text());
};

const sourceConfigPlugin = (env: Record<string, string>): Plugin => ({
  name: "source-config",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!matchesEndpoint(req, CONFIG_ENDPOINT)) {
        next();
        return;
      }
      void respond(res, configEndpoint(env));
    });
  },
});

const resolveRedirectPlugin = (): Plugin => ({
  name: "resolve-redirect",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!matchesEndpoint(req, RESOLVE_ENDPOINT)) {
        next();
        return;
      }
      void resolveRedirectEndpoint(requestFrom(req)).then(
        (response) => respond(res, response),
        () => undefined, // the endpoint already encoded the failure in its Response
      );
    });
  },
});

const probePlayerPlugin = (): Plugin => ({
  name: "probe-player",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!matchesEndpoint(req, PROBE_ENDPOINT)) {
        next();
        return;
      }
      void probePlayerEndpoint(requestFrom(req)).then(
        (response) => respond(res, response),
        () => undefined, // the endpoint already encoded the failure in its Response
      );
    });
  },
});

export default defineConfig(({ mode }) => {
  // Third name "" reads every variable, not just VITE_*-prefixed ones: the
  // endpoint lists must stay server-side, never inlined into the bundle.
  const env = loadEnv(mode, process.cwd(), "");
  return { plugins: [react(), sourceConfigPlugin(env), resolveRedirectPlugin(), probePlayerPlugin()], server: { port: 5188, strictPort: true } };
});
