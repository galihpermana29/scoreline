import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Connect, type Plugin } from "vite";
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

type Middlewares = { middlewares: Connect.Server };

/**
 * One same-origin endpoint, mounted on both the dev server and `vite
 * preview`, so a production build served locally (the TV checks load it
 * over the LAN; dev mode's hundreds of modules are too slow there) talks
 * to the same API it does on Vercel.
 */
const endpointPlugin = (name: string, endpoint: string, handle: (req: IncomingMessage) => Response | Promise<Response>): Plugin => {
  const mount = (server: Middlewares) => {
    server.middlewares.use((req, res, next) => {
      if (!matchesEndpoint(req, endpoint)) {
        next();
        return;
      }
      void Promise.resolve(handle(req)).then(
        (response) => respond(res, response),
        () => undefined, // the endpoint already encoded the failure in its Response
      );
    });
  };
  return { name, configureServer: mount, configurePreviewServer: mount };
};

export default defineConfig(({ mode }) => {
  // Third name "" reads every variable, not just VITE_*-prefixed ones: the
  // endpoint lists must stay server-side, never inlined into the bundle.
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [
      react(),
      endpointPlugin("source-config", CONFIG_ENDPOINT, () => configEndpoint(env)),
      endpointPlugin("resolve-redirect", RESOLVE_ENDPOINT, (req) => resolveRedirectEndpoint(requestFrom(req))),
      endpointPlugin("probe-player", PROBE_ENDPOINT, (req) => probePlayerEndpoint(requestFrom(req))),
    ],
    server: { port: 5188, strictPort: true },
  };
});
